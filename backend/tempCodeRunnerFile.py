# Congestion Heatmap Logic
# Computes zone-level congestion without exposing personal SURGE IDs

from datetime import datetime, timedelta
from collections import defaultdict
import json
from enum import Enum


class CongestionLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


# Thresholds for congestion classification
# These can be tuned based on real-world data
CONGESTION_THRESHOLDS = {
    "low_max": 100,      # scores below this are LOW
    "medium_max": 300    # scores below this are MEDIUM, above is HIGH
}

# Rolling window for scan rate calculation
SCAN_RATE_WINDOW_MINUTES = 5


def get_all_surge_ids(redis_client) -> list[str]:
    """
    Get all active SURGE IDs from Redis.
    Active IDs are stored as surge:{id} keys.
    """
    surge_ids = []
    # Scan for all surge:* keys that don't have :scans suffix
    cursor = 0
    while True:
        cursor, keys = redis_client.scan(cursor, match="surge:*", count=100)
        for key in keys:
            # Filter out scan lists, only get base surge IDs
            if ":scans" not in key:
                # Extract the ID from surge:{id}
                surge_id = key.replace("surge:", "")
                surge_ids.append(surge_id)
        if cursor == 0:
            break
    return surge_ids


def get_scans_for_surge_id(redis_client, surge_id: str) -> list[dict]:
    """
    Get all scan events for a specific SURGE ID.
    Returns list of {zone, timestamp} dicts sorted by timestamp.
    """
    scans_key = f"surge:{surge_id}:scans"
    raw_scans = redis_client.lrange(scans_key, 0, -1)

    scans = []
    for raw in raw_scans:
        try:
            scan = json.loads(raw)
            # Parse the ISO timestamp
            scan["timestamp"] = datetime.fromisoformat(scan["timestamp"])
            scans.append(scan)
        except (json.JSONDecodeError, KeyError, ValueError):
            continue

    # Sort by timestamp
    scans.sort(key=lambda x: x["timestamp"])
    return scans


def compute_dwell_times(scans: list[dict]) -> dict[str, list[float]]:
    """
    Compute dwell times for each zone based on consecutive scans.
    Dwell time = time spent in a zone before moving to the next.

    For each consecutive scan pair:
        dwell = next_time - current_time
        Assign dwell to the zone of the current scan

    Returns dict mapping zone -> list of dwell times in seconds
    """
    dwell_times = defaultdict(list)

    for i in range(len(scans) - 1):
        current_scan = scans[i]
        next_scan = scans[i + 1]

        current_zone = current_scan["zone"]
        current_time = current_scan["timestamp"]
        next_time = next_scan["timestamp"]

        # Calculate dwell time in seconds
        dwell = (next_time - current_time).total_seconds()

        # Only count positive, reasonable dwell times (< 2 hours)
        if 0 < dwell < 7200:
            dwell_times[current_zone].append(dwell)

    return dict(dwell_times)


def aggregate_dwell_by_zone(all_dwell_times: list[dict[str, list[float]]]) -> dict[str, float]:
    """
    Aggregate all dwell times across all SURGE IDs and compute average per zone.
    Returns dict mapping zone -> average dwell time in seconds
    """
    zone_dwells = defaultdict(list)

    for dwell_dict in all_dwell_times:
        for zone, times in dwell_dict.items():
            zone_dwells[zone].extend(times)

    # Compute averages
    avg_dwells = {}
    for zone, times in zone_dwells.items():
        if times:
            avg_dwells[zone] = sum(times) / len(times)
        else:
            avg_dwells[zone] = 0.0

    return avg_dwells


def compute_scan_rate(redis_client, surge_ids: list[str], window_minutes: int = SCAN_RATE_WINDOW_MINUTES) -> dict[str, int]:
    """
    Count scans per zone within the rolling time window.
    Returns dict mapping zone -> scan count
    """
    cutoff_time = datetime.utcnow() - timedelta(minutes=window_minutes)
    zone_counts = defaultdict(int)

    for surge_id in surge_ids:
        scans = get_scans_for_surge_id(redis_client, surge_id)
        for scan in scans:
            if scan["timestamp"] >= cutoff_time:
                zone_counts[scan["zone"]] += 1

    return dict(zone_counts)


def calculate_congestion_score(scan_rate: int, avg_dwell_time: float) -> float:
    """
    Calculate congestion score for a zone.
    Higher scan rate + higher dwell time = more congestion

    Formula: congestion = scan_rate × avg_dwell_time
    """
    return scan_rate * avg_dwell_time


def classify_congestion(score: float) -> CongestionLevel:
    """
    Map congestion score to LOW / MEDIUM / HIGH classification.
    """
    if score < CONGESTION_THRESHOLDS["low_max"]:
        return CongestionLevel.LOW
    elif score < CONGESTION_THRESHOLDS["medium_max"]:
        return CongestionLevel.MEDIUM
    else:
        return CongestionLevel.HIGH


def get_zone_congestion(redis_client) -> dict:
    """
    Main function to compute congestion data for all zones.

    Returns anonymized zone-level data with no SURGE IDs or personal info:
    {
        "zones": {
            "zone_name": {
                "congestion_level": "LOW" | "MEDIUM" | "HIGH",
                "congestion_score": float,
                "avg_dwell_time_seconds": float,
                "scan_count_last_5min": int
            },
            ...
        },
        "computed_at": "ISO timestamp"
    }
    """
    # Get all active SURGE IDs
    surge_ids = get_all_surge_ids(redis_client)

    # Collect dwell times from all SURGE IDs
    all_dwell_times = []
    for surge_id in surge_ids:
        scans = get_scans_for_surge_id(redis_client, surge_id)
        if scans:
            dwell_times = compute_dwell_times(scans)
            all_dwell_times.append(dwell_times)

    # Aggregate dwell times by zone
    avg_dwell_by_zone = aggregate_dwell_by_zone(all_dwell_times)

    # Compute scan rates per zone
    scan_rates = compute_scan_rate(redis_client, surge_ids)

    # Get all known zones
    all_zones = set(avg_dwell_by_zone.keys()) | set(scan_rates.keys())

    # If no data, include all valid zones with zero values
    from main import VALID_ZONES
    all_zones = all_zones | VALID_ZONES

    # Build zone congestion data
    zones_data = {}
    for zone in all_zones:
        avg_dwell = avg_dwell_by_zone.get(zone, 0.0)
        scan_count = scan_rates.get(zone, 0)

        score = calculate_congestion_score(scan_count, avg_dwell)
        level = classify_congestion(score)

        zones_data[zone] = {
            "congestion_level": level.value,
            "congestion_score": round(score, 2),
            "avg_dwell_time_seconds": round(avg_dwell, 2),
            "scan_count_last_5min": scan_count
        }

    return {
        "zones": zones_data,
        "computed_at": datetime.utcnow().isoformat(),
        "window_minutes": SCAN_RATE_WINDOW_MINUTES
    }
