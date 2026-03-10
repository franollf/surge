# Surge Main.py
from congestion import get_zone_congestion
from fastapi import FastAPI, HTTPException, Query, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from storage import create_surge_id
from qr import generate_qr_code
from zone_scheduling import (
    set_zone_inactive,
    remove_zone_inactive,
    get_inactive_zones_for_building,
    get_active_zone_ids,
    is_zone_active,
)
from auth import verify_token
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel
import redis
import json
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="SURGE")

# ─────────────────────────────────────────────
# CORS
# ─────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Surge-ID"]
)

# ─────────────────────────────────────────────
# Redis
# ─────────────────────────────────────────────
REDIS_HOST = os.getenv("REDIS_HOST")
REDIS_PORT = os.getenv("REDIS_PORT")

r = redis.Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    decode_responses=True,
    socket_connect_timeout=2,
    socket_timeout=2
)

# ─────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────


class ScanRequest(BaseModel):
    surge_id: str
    zone_id: str
    building_id: str


class BulkScanRequest(BaseModel):
    surge_ids: List[str]
    zone_id: str
    building_id: str


class BuildingConfig(BaseModel):
    building_id: str
    building_name: str
    default_floor_id: str
    floors: list
    zones: list
    owner_id: Optional[str] = None


class ZoneScheduleRequest(BaseModel):
    building_id: str
    zone_id: str
    date: str  # YYYY-MM-DD format


# ─────────────────────────────────────────────
# Zone Name → ID Resolution
# ─────────────────────────────────────────────

def resolve_zone_id(zones: list, zone_input: str) -> str | None:
    """
    Accepts a zone_id or zone_name and returns the matching zone_id.
    Tries: exact zone_id → case-insensitive zone_name → case-insensitive zone_id.
    Returns None if no match found.
    """
    zone_lower = zone_input.strip().lower()

    for z in zones:
        if z.get("zone_id") == zone_input:
            return z["zone_id"]

    for z in zones:
        if (z.get("zone_name") or "").strip().lower() == zone_lower:
            return z["zone_id"]

    for z in zones:
        if (z.get("zone_id") or "").strip().lower() == zone_lower:
            return z["zone_id"]

    return None


# ─────────────────────────────────────────────
# Issue SURGE ID
# ─────────────────────────────────────────────
@app.get("/issue")
def issue_surge_id():
    surge = create_surge_id()

    r.set(f"surge:{surge.id}", "active", ex=3600)

    qr_buffer = generate_qr_code(str(surge.id))

    return StreamingResponse(
        qr_buffer,
        media_type="image/png",
        headers={"X-Surge-ID": str(surge.id)}
    )


# ─────────────────────────────────────────────
# Save Building Config (WITH AUTH)
# ─────────────────────────────────────────────
@app.post("/buildings/{building_id}/config")
def save_building_config(
    building_id: str,
    config: BuildingConfig,
    authorization: str = Header(None)
):
    print(f"📥 Saving building: {building_id}")

    # ENFORCE authentication
    user_id = verify_token(authorization)
    print(f"✅ Authenticated user: {user_id}")

    # Add owner to config
    config_dict = config.dict()
    config_dict['owner_id'] = user_id

    # Save building config
    r.set(
        f"surge:building:{building_id}:config",
        json.dumps(config_dict)
    )

    # Maintain user->buildings index
    r.sadd(f"surge:user:{user_id}:buildings", building_id)

    print(f"✅ Building saved successfully for user {user_id}")

    return {"success": True, "building_id": building_id, "owner_id": user_id}


# ─────────────────────────────────────────────
# Get Building Config (WITH OWNERSHIP CHECK)
# ─────────────────────────────────────────────
@app.get("/buildings/{building_id}/config")
def get_building_config(
    building_id: str,
    authorization: str = Header(None)
):
    print(f"📤 Loading building: {building_id}")

    # ENFORCE authentication
    user_id = verify_token(authorization)
    print(f"✅ Authenticated user: {user_id}")

    raw = r.get(f"surge:building:{building_id}:config")

    if not raw:
        print(f"❌ Building not found: {building_id}")
        raise HTTPException(status_code=404, detail="No config found")

    config = json.loads(raw)

    # ENFORCE ownership check
    if config.get('owner_id') != user_id:
        print(
            f"🚫 Access denied: User {user_id} tried to access building owned by {config.get('owner_id')}")
        raise HTTPException(
            status_code=403, detail="Access denied: You don't own this building")

    print(f"✅ Building loaded: {building_id}")

    return config


# ─────────────────────────────────────────────
# List Buildings (USER-SPECIFIC)
# ─────────────────────────────────────────────
@app.get("/buildings")
def list_buildings(authorization: str = Header(None)):
    """
    Returns all building IDs owned by the authenticated user.
    """
    print("📋 Listing buildings")

    # ENFORCE authentication
    user_id = verify_token(authorization)
    print(f"✅ Authenticated user: {user_id}")

    # Get buildings for this specific user ONLY
    building_ids = r.smembers(f"surge:user:{user_id}:buildings")

    print(f"Found {len(building_ids)} buildings for user {user_id}")

    return {"buildings": list(building_ids)}


# ─────────────────────────────────────────────
# Scan Endpoint
# ─────────────────────────────────────────────
@app.post("/scan")
def record_scan(request: ScanRequest):
    """
    Record a passenger scanning into a zone.
    """
    surge_id = request.surge_id
    zone_id = request.zone_id
    building_id = request.building_id

    # Verify SURGE ID exists
    if not r.exists(f"surge:{surge_id}"):
        raise HTTPException(status_code=404, detail="Invalid SURGE ID")

    # Check if zone is active today
    if not is_zone_active(r, building_id, zone_id):
        raise HTTPException(
            status_code=403,
            detail=f"Zone '{zone_id}' is inactive today"
        )

    # Get building config to resolve zone
    config_raw = r.get(f"surge:building:{building_id}:config")
    if not config_raw:
        raise HTTPException(status_code=404, detail="Building not found")

    config = json.loads(config_raw)
    resolved_zone_id = resolve_zone_id(config["zones"], zone_id)

    if not resolved_zone_id:
        raise HTTPException(
            status_code=404, detail=f"Zone '{zone_id}' not found in building '{building_id}'")

    # Record the scan
    scan_data = {
        "zone": resolved_zone_id,
        "building_id": building_id,
        "timestamp": datetime.utcnow().isoformat()
    }

    r.lpush(f"surge:{surge_id}:scans", json.dumps(scan_data))
    r.set(f"surge:{surge_id}:current_zone", resolved_zone_id, ex=3600)
    r.expire(f"surge:{surge_id}:scans", 3600)

    return {
        "success": True,
        "surge_id": surge_id,
        "zone_id": resolved_zone_id,
        "building_id": building_id,
        "timestamp": scan_data["timestamp"]
    }


# ─────────────────────────────────────────────
# Bulk Scan Endpoint
# ─────────────────────────────────────────────
@app.post("/scan/bulk")
def record_bulk_scan(request: BulkScanRequest):
    """
    Record multiple passengers scanning into the same zone at once.
    """
    zone_id = request.zone_id
    building_id = request.building_id
    surge_ids = request.surge_ids

    # Verify building exists
    config_raw = r.get(f"surge:building:{building_id}:config")
    if not config_raw:
        raise HTTPException(status_code=404, detail="Building not found")

    config = json.loads(config_raw)
    resolved_zone_id = resolve_zone_id(config["zones"], zone_id)

    if not resolved_zone_id:
        raise HTTPException(
            status_code=404, detail=f"Zone '{zone_id}' not found")

    # Check if zone is active
    if not is_zone_active(r, building_id, resolved_zone_id):
        raise HTTPException(
            status_code=403,
            detail=f"Zone '{resolved_zone_id}' is inactive today"
        )

    results = []
    timestamp = datetime.utcnow().isoformat()

    for surge_id in surge_ids:
        if not r.exists(f"surge:{surge_id}"):
            results.append(
                {"surge_id": surge_id, "success": False, "error": "Invalid SURGE ID"})
            continue

        scan_data = {
            "zone": resolved_zone_id,
            "building_id": building_id,
            "timestamp": timestamp
        }

        r.lpush(f"surge:{surge_id}:scans", json.dumps(scan_data))
        r.set(f"surge:{surge_id}:current_zone", resolved_zone_id, ex=3600)
        r.expire(f"surge:{surge_id}:scans", 3600)

        results.append({"surge_id": surge_id, "success": True})

    return {
        "total": len(surge_ids),
        "successful": sum(1 for r in results if r["success"]),
        "results": results
    }


# ─────────────────────────────────────────────
# Congestion Data
# ─────────────────────────────────────────────
@app.get("/congestion/{building_id}")
def get_congestion(building_id: str):
    """
    Get real-time congestion data for all zones in a building.
    """
    return get_zone_congestion(r, building_id)


# ─────────────────────────────────────────────
# Zone Inactivity Scheduling
# ─────────────────────────────────────────────

@app.post("/buildings/{building_id}/zones/schedule-inactive")
def schedule_zone_inactive(building_id: str, data: ZoneScheduleRequest):
    """
    Schedule a zone as inactive on a specific calendar date.
    When inactive, the zone won't appear in congestion data
    and scans to that zone will be rejected.
    """
    result = set_zone_inactive(r, building_id, data.zone_id, data.date)

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    return result


@app.delete("/buildings/{building_id}/zones/schedule-inactive")
def unschedule_zone_inactive(building_id: str, zone_id: str, date: str = Query(...)):
    """
    Remove an inactive schedule for a zone on a specific date.
    """
    result = remove_zone_inactive(r, building_id, zone_id, date)

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    return result


@app.get("/buildings/{building_id}/zones/inactive")
def get_inactive_zones(building_id: str, date: str = Query(None)):
    """
    Get all inactive zones for a building on a specific date (or all dates).
    """
    zones = get_inactive_zones_for_building(r, building_id, date)
    return {"inactive_zones": zones}


@app.get("/buildings/{building_id}/zones/active")
def get_active_zones(building_id: str):
    """
    Get all currently active zone IDs for a building (filters out today's inactive zones).
    """
    active_ids = get_active_zone_ids(r, building_id)
    return {"active_zone_ids": active_ids}
