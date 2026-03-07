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


def _validate_building_zone(redis_client, building_id: str, zone_id: str) -> dict | None:
    """
    Validate that the building exists and the zone belongs to it.
    Returns the config dict if valid, or an error dict if not.
    """
    config_raw = redis_client.get(f"surge:building:{building_id}:config")

    if not config_raw:
        return {"error": f"Building '{building_id}' not found"}

    config = json.loads(config_raw)
    valid_zone_ids = {z["zone_id"] for z in config["zones"]}

    if zone_id not in valid_zone_ids:
        return {"error": f"Zone '{zone_id}' does not exist in building '{building_id}'"}

    return None  # No error


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
    """
    # Validate date
    date_err = _validate_date(target_date)
    if date_err:
        return date_err

    # Validate building + zone
    bz_err = _validate_building_zone(redis_client, building_id, zone_id)
    if bz_err:
        return bz_err

    key = _make_key(building_id, zone_id, target_date)
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
    date_err = _validate_date(target_date)
    if date_err:
        return date_err

    key = _make_key(building_id, zone_id, target_date)
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

    # Load building config to get all zone IDs
    config_raw = redis_client.get(f"surge:building:{building_id}:config")
    if not config_raw:
        return []

    config = json.loads(config_raw)
    inactive = []

    for zone in config["zones"]:
        key = _make_key(building_id, zone["zone_id"], target_date)
        if redis_client.exists(key):
            inactive.append({
                "zone_id": zone["zone_id"],
                "zone_name": zone.get("zone_name", zone["zone_id"]),
                "floor_id": zone.get("floor_id"),
                "date": target_date
            })

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
