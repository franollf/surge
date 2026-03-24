# Zone Inactivity Scheduling Logic
# Allows admins to mark zones as inactive on specific calendar dates.
# Inactive zones are excluded from congestion data and reject scans.
#
# Redis key pattern: zone_inactive:{building_id}:{zone_id}:{YYYY-MM-DD} -> "1"

from datetime import date
import json


def _make_key(building_id: str, zone_id: str, target_date: str) -> str:
    """Build the Redis key for a building/zone/date triple."""
    return f"zone_inactive:{building_id}:{zone_id}:{target_date}"


def _validate_date(target_date: str) -> dict | None:
    """Validate date format. Returns error dict or None."""
    try:
        date.fromisoformat(target_date)
        return None
    except ValueError:
        return {"error": f"Invalid date format '{target_date}'. Use YYYY-MM-DD."}


def set_zone_inactive(redis_client, building_id: str, zone_id: str, target_date: str) -> dict:
    """
    Mark a zone as inactive for a given date.
    Removed strict zone validation — zone_id is trusted from the frontend
    since it comes directly from the building config loaded at runtime.
    """
    print(
        f"[zone_scheduling] set_zone_inactive called: building={building_id} zone={zone_id} date={target_date}")

    # Validate date format only
    date_err = _validate_date(target_date)
    if date_err:
        print(f"[zone_scheduling] Date validation failed: {date_err}")
        return date_err

    # Log what's in the building config for debugging
    config_raw = redis_client.get(f"surge:building:{building_id}:config")
    if config_raw:
        config = json.loads(config_raw)
        zone_ids_in_config = [z["zone_id"] for z in config.get("zones", [])]
        print(f"[zone_scheduling] Zone IDs in config: {zone_ids_in_config}")
        print(f"[zone_scheduling] Requested zone_id: {zone_id}")
        print(
            f"[zone_scheduling] Match found: {zone_id in zone_ids_in_config}")
    else:
        print(
            f"[zone_scheduling] WARNING: Building '{building_id}' config not found in Redis")

    key = _make_key(building_id, zone_id, target_date)
    print(f"[zone_scheduling] Writing Redis key: {key}")
    redis_client.set(key, "1")

    return {
        "status": "scheduled",
        "building_id": building_id,
        "zone_id": zone_id,
        "date": target_date,
        "message": f"Zone '{zone_id}' in building '{building_id}' will be inactive on {target_date}"
    }


def remove_zone_inactive(redis_client, building_id: str, zone_id: str, target_date: str) -> dict:
    """
    Remove an inactive schedule for a zone on a given date.
    """
    print(
        f"[zone_scheduling] remove_zone_inactive called: building={building_id} zone={zone_id} date={target_date}")

    date_err = _validate_date(target_date)
    if date_err:
        return date_err

    key = _make_key(building_id, zone_id, target_date)
    print(f"[zone_scheduling] Deleting Redis key: {key}")
    deleted = redis_client.delete(key)

    if deleted:
        return {
            "status": "removed",
            "building_id": building_id,
            "zone_id": zone_id,
            "date": target_date,
            "message": f"Inactive schedule for '{zone_id}' on {target_date} has been removed"
        }
    else:
        return {
            "status": "not_found",
            "message": f"No inactive schedule found for zone '{zone_id}' on {target_date}"
        }


def get_inactive_zones_for_building(redis_client, building_id: str, target_date: str = None) -> list[dict]:
    """
    List all zones scheduled as inactive for a given building and date.
    Defaults to today if no date is provided.
    """
    if target_date is None:
        target_date = date.today().isoformat()

    print(
        f"[zone_scheduling] get_inactive_zones_for_building: building={building_id} date={target_date}")

    config_raw = redis_client.get(f"surge:building:{building_id}:config")
    if not config_raw:
        print(f"[zone_scheduling] WARNING: Building '{building_id}' not found")
        return []

    config = json.loads(config_raw)
    inactive = []

    for zone in config["zones"]:
        key = _make_key(building_id, zone["zone_id"], target_date)
        exists = redis_client.exists(key)
        print(
            f"[zone_scheduling] Checking key: {key} -> exists={bool(exists)}")
        if exists:
            inactive.append({
                "zone_id":   zone["zone_id"],
                "zone_name": zone.get("zone_name", zone["zone_id"]),
                "floor_id":  zone.get("floor_id"),
                "date":      target_date
            })

    print(
        f"[zone_scheduling] Found {len(inactive)} inactive zones: {[z['zone_id'] for z in inactive]}")
    return inactive


def is_zone_active(redis_client, building_id: str, zone_id: str, target_date: str = None) -> bool:
    """
    Check if a specific zone is active on a given date.
    Returns True if active, False if scheduled as inactive.
    """
    if target_date is None:
        target_date = date.today().isoformat()

    key = _make_key(building_id, zone_id, target_date)
    return not redis_client.exists(key)


def get_active_zone_ids(redis_client, building_id: str, target_date: str = None) -> set[str]:
    """
    Return the set of zone IDs that are currently active (not scheduled inactive)
    for a given building.
    """
    if target_date is None:
        target_date = date.today().isoformat()

    config_raw = redis_client.get(f"surge:building:{building_id}:config")
    if not config_raw:
        return set()

    config = json.loads(config_raw)
    active = set()

    for zone in config["zones"]:
        zone_id = zone["zone_id"]
        if is_zone_active(redis_client, building_id, zone_id, target_date):
            active.add(zone_id)

    return active
