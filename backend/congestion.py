# congestion.py
# Multi-Building Hybrid Congestion + Real Estimated Wait Time Engine

from datetime import datetime, timedelta
from collections import defaultdict
import json
from enum import Enum


class CongestionLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────

CONGESTION_THRESHOLDS = {
    "low_max": 50,
    "medium_max": 150
}

SCAN_RATE_WINDOW_MINUTES = 5

OCCUPANCY_WEIGHT = 2.0
FLOW_WEIGHT = 1.5
DWELL_WEIGHT = 0.05

MIN_THROUGHPUT = 0.5
STABILITY_CONSTANT = 1


# ─────────────────────────────────────────────
# Redis Helpers
# ─────────────────────────────────────────────

def get_all_surge_ids(redis_client) -> list[str]:
    surge_ids = []
    cursor = 0

    while True:
        cursor, keys = redis_client.scan(cursor, match="surge:*", count=100)

        for key in keys:
            # only top-level surge keys
            if key.count(":") == 1:
                surge_ids.append(key.replace("surge:", ""))

        if cursor == 0:
            break

    return surge_ids


def get_scans_for_surge_id(redis_client, surge_id: str) -> list[dict]:
    scans_key = f"surge:{surge_id}:scans"
    raw_scans = redis_client.lrange(scans_key, 0, -1)

    scans = []

    for raw in raw_scans:
        try:
            scan = json.loads(raw)
            scan["timestamp"] = datetime.fromisoformat(scan["timestamp"])
            scans.append(scan)
        except (json.JSONDecodeError, KeyError, ValueError):
            continue

    scans.sort(key=lambda x: x["timestamp"])
    return scans


# ─────────────────────────────────────────────
# Occupancy
# ─────────────────────────────────────────────

def compute_active_occupancy(redis_client, surge_ids, building_id):
    zone_counts = defaultdict(int)

    for surge_id in surge_ids:
        scans = get_scans_for_surge_id(redis_client, surge_id)

        if scans:
            latest = scans[-1]

            if latest.get("building_id") == building_id:
                zone_counts[latest["zone"]] += 1

    return dict(zone_counts)


# ─────────────────────────────────────────────
# Dwell
# ─────────────────────────────────────────────

def compute_dwell_times(scans, building_id):
    dwell_times = defaultdict(list)

    for i in range(len(scans) - 1):
        current = scans[i]
        next_scan = scans[i + 1]

        if current.get("building_id") != building_id:
            continue

        dwell = (
            next_scan["timestamp"] - current["timestamp"]
        ).total_seconds()

        if 0 < dwell < 7200:
            dwell_times[current["zone"]].append(dwell)

    return dict(dwell_times)


def aggregate_dwell_by_zone(all_dwell_times):
    zone_dwells = defaultdict(list)

    for dwell_dict in all_dwell_times:
        for zone, times in dwell_dict.items():
            zone_dwells[zone].extend(times)

    avg = {}

    for zone, times in zone_dwells.items():
        avg[zone] = sum(times) / len(times) if times else 0.0

    return avg


# ─────────────────────────────────────────────
# Flow / Throughput
# ─────────────────────────────────────────────

def compute_scan_rate(redis_client, surge_ids, building_id):
    cutoff = datetime.utcnow() - timedelta(minutes=SCAN_RATE_WINDOW_MINUTES)
    zone_counts = defaultdict(int)

    for surge_id in surge_ids:
        scans = get_scans_for_surge_id(redis_client, surge_id)

        for scan in scans:
            if (
                scan.get("building_id") == building_id
                and scan["timestamp"] >= cutoff
            ):
                zone_counts[scan["zone"]] += 1

    return dict(zone_counts)


def compute_processing_rate(redis_client, surge_ids, building_id):
    cutoff = datetime.utcnow() - timedelta(minutes=SCAN_RATE_WINDOW_MINUTES)
    departures = defaultdict(int)

    for surge_id in surge_ids:
        scans = get_scans_for_surge_id(redis_client, surge_id)

        for i in range(len(scans) - 1):
            current = scans[i]
            next_scan = scans[i + 1]

            if (
                current.get("building_id") == building_id
                and next_scan["timestamp"] >= cutoff
            ):
                departures[current["zone"]] += 1

    processing_rate = {}

    for zone, count in departures.items():
        processing_rate[zone] = count / SCAN_RATE_WINDOW_MINUTES

    return processing_rate


# ─────────────────────────────────────────────
# Wait Time
# ─────────────────────────────────────────────

def estimate_wait_time(active_count, processing_rate):
    effective_rate = max(processing_rate, MIN_THROUGHPUT)
    wait = active_count / (effective_rate + STABILITY_CONSTANT)
    return int(round(wait))


# ─────────────────────────────────────────────
# Congestion Scoring
# ─────────────────────────────────────────────

def calculate_congestion_score(active_count, scan_rate, avg_dwell):
    return (
        active_count * OCCUPANCY_WEIGHT
        + scan_rate * FLOW_WEIGHT
        + avg_dwell * DWELL_WEIGHT
    )


def classify_congestion(score):
    if score < CONGESTION_THRESHOLDS["low_max"]:
        return CongestionLevel.LOW
    elif score < CONGESTION_THRESHOLDS["medium_max"]:
        return CongestionLevel.MEDIUM
    return CongestionLevel.HIGH


# ─────────────────────────────────────────────
# Main Entry Point
# ─────────────────────────────────────────────

def get_zone_congestion(redis_client, building_id: str, active_zones: set[str] = None) -> dict:

    # Load building config
    config_raw = redis_client.get(
        f"surge:building:{building_id}:config"
    )

    if not config_raw:
        return {
            "zones": {},
            "computed_at": datetime.utcnow().isoformat(),
            "window_minutes": SCAN_RATE_WINDOW_MINUTES
        }

    config = json.loads(config_raw)

    defined_zones = {z["zone_id"] for z in config["zones"]}

    # Filter to only active zones if provided
    if active_zones is not None:
        defined_zones = defined_zones & active_zones

    surge_ids = get_all_surge_ids(redis_client)

    # Compute dwell
    all_dwell_times = []

    for surge_id in surge_ids:
        scans = get_scans_for_surge_id(redis_client, surge_id)

        if scans:
            all_dwell_times.append(
                compute_dwell_times(scans, building_id)
            )

    avg_dwell_by_zone = aggregate_dwell_by_zone(all_dwell_times)
    scan_rates = compute_scan_rate(redis_client, surge_ids, building_id)
    active_counts = compute_active_occupancy(
        redis_client, surge_ids, building_id
    )
    processing_rates = compute_processing_rate(
        redis_client, surge_ids, building_id
    )

    zones_data = {}

    for zone in defined_zones:

        active = active_counts.get(zone, 0)
        scan_rate = scan_rates.get(zone, 0)
        avg_dwell = avg_dwell_by_zone.get(zone, 0.0)
        processing_rate = processing_rates.get(zone, 0)

        if active == 0:
            score = 0.0
            level = CongestionLevel.LOW
            estimated_wait = 0
        else:
            score = calculate_congestion_score(
                active, scan_rate, avg_dwell
            )
            level = classify_congestion(score)
            estimated_wait = estimate_wait_time(
                active, processing_rate
            )

        zones_data[zone] = {
            "congestion_level": level.value,
            "congestion_score": round(score, 2),
            "active_passengers": active,
            "avg_dwell_time_seconds": round(avg_dwell, 2),
            "scan_count_last_5min": scan_rate,
            "estimated_wait_minutes": round(estimated_wait, 1)
        }

    return {
        "zones": zones_data,
        "computed_at": datetime.utcnow().isoformat(),
        "window_minutes": SCAN_RATE_WINDOW_MINUTES
    }
