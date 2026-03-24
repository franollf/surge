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
from airport_zones import validate_building_zones, VALID_ZONE_TYPES, get_zone_label, AIRPORT_ZONE_TYPES, PARTICIPATION_RATE

load_dotenv()

app = FastAPI(title="SURGE")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Surge-ID"]
)

# Redis
REDIS_HOST = os.getenv("REDIS_HOST")
REDIS_PORT = os.getenv("REDIS_PORT")

r = redis.Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    decode_responses=True,
    socket_connect_timeout=2,
    socket_timeout=2
)

# Models


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
    incentives: Optional[dict] = None


class ZoneScheduleRequest(BaseModel):
    building_id: str
    zone_id: str
    date: str  # YYYY-MM-DD format


class QueueJoinRequest(BaseModel):
    surge_id: str


class StaffScanRequest(BaseModel):
    building_id:     str
    zone_id:         str
    passenger_count: int
    staff_id:        Optional[str] = None


# Zone Name → ID Resolution

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


# Issue SURGE ID
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


# Save Building Config
@app.post("/buildings/{building_id}/config")
def save_building_config(
    building_id: str,
    config: BuildingConfig,
    authorization: str = Header(None)
):
    user_id = verify_token(authorization)

    zone_errors = validate_building_zones(config.zones)
    if zone_errors:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Invalid zone types. Only airport zones are allowed.",
                "errors":  zone_errors,
                "valid_zone_types": list(VALID_ZONE_TYPES),
            }
        )

    config_dict = config.dict()
    config_dict['owner_id'] = user_id

    r.set(
        f"surge:building:{building_id}:config",
        json.dumps(config_dict)
    )

    r.sadd(f"surge:user:{user_id}:buildings", building_id)

    return {"success": True, "building_id": building_id, "owner_id": user_id}


# Get Building Config
@app.get("/buildings/{building_id}/config")
def get_building_config(
    building_id: str,
    authorization: str = Header(None)
):
    user_id = verify_token(authorization)

    raw = r.get(f"surge:building:{building_id}:config")

    if not raw:
        raise HTTPException(status_code=404, detail="No config found")

    config = json.loads(raw)

    if config.get('owner_id') != user_id:
        raise HTTPException(
            status_code=403, detail="Access denied: You don't own this building")

    return config


# List Buildings
@app.get("/buildings")
def list_buildings(authorization: str = Header(None)):
    """Returns all building IDs owned by the authenticated user."""
    user_id = verify_token(authorization)

    building_ids = r.smembers(f"surge:user:{user_id}:buildings")

    return {"buildings": list(building_ids)}


# Scan Endpoint
@app.post("/scan")
def record_scan(request: ScanRequest):
    """Record a passenger scanning into a zone."""
    surge_id = request.surge_id
    zone_id = request.zone_id
    building_id = request.building_id

    if not r.exists(f"surge:{surge_id}"):
        raise HTTPException(status_code=404, detail="Invalid SURGE ID")

    if not is_zone_active(r, building_id, zone_id):
        raise HTTPException(
            status_code=403,
            detail=f"Zone '{zone_id}' is inactive today"
        )

    config_raw = r.get(f"surge:building:{building_id}:config")
    if not config_raw:
        raise HTTPException(status_code=404, detail="Building not found")

    config = json.loads(config_raw)
    resolved_zone_id = resolve_zone_id(config["zones"], zone_id)

    if not resolved_zone_id:
        raise HTTPException(
            status_code=404,
            detail=f"Zone '{zone_id}' not found. Valid airport zones: {', '.join(sorted(VALID_ZONE_TYPES))}"
        )

    scan_data = {
        "zone":        resolved_zone_id,
        "building_id": building_id,
        "timestamp":   datetime.utcnow().isoformat()
    }

    r.lpush(f"surge:{surge_id}:scans", json.dumps(scan_data))
    r.set(f"surge:{surge_id}:current_zone", resolved_zone_id, ex=3600)
    r.expire(f"surge:{surge_id}:scans", 3600)

    return {
        "success":     True,
        "surge_id":    surge_id,
        "zone_id":     resolved_zone_id,
        "building_id": building_id,
        "timestamp":   scan_data["timestamp"]
    }


# Bulk Scan Endpoint
@app.post("/scan/bulk")
def record_bulk_scan(request: BulkScanRequest):
    """Record multiple passengers scanning into the same zone at once."""
    zone_id = request.zone_id
    building_id = request.building_id
    surge_ids = request.surge_ids

    config_raw = r.get(f"surge:building:{building_id}:config")
    if not config_raw:
        raise HTTPException(status_code=404, detail="Building not found")

    config = json.loads(config_raw)
    resolved_zone_id = resolve_zone_id(config["zones"], zone_id)

    if not resolved_zone_id:
        raise HTTPException(
            status_code=404,
            detail=f"Zone '{zone_id}' not found. Valid airport zones: {', '.join(sorted(VALID_ZONE_TYPES))}"
        )

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
            "zone":        resolved_zone_id,
            "building_id": building_id,
            "timestamp":   timestamp
        }

        r.lpush(f"surge:{surge_id}:scans", json.dumps(scan_data))
        r.set(f"surge:{surge_id}:current_zone", resolved_zone_id, ex=3600)
        r.expire(f"surge:{surge_id}:scans", 3600)

        results.append({"surge_id": surge_id, "success": True})

    return {
        "total":      len(surge_ids),
        "successful": sum(1 for res in results if res["success"]),
        "results":    results
    }


# Congestion Data
@app.get("/congestion/{building_id}")
def get_congestion(building_id: str):
    """Get real-time congestion data for all zones in a building."""
    return get_zone_congestion(r, building_id)


# Zone Inactivity Scheduling

@app.post("/buildings/{building_id}/zones/schedule-inactive")
def schedule_zone_inactive(building_id: str, data: ZoneScheduleRequest):
    result = set_zone_inactive(r, building_id, data.zone_id, data.date)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.delete("/buildings/{building_id}/zones/schedule-inactive")
def unschedule_zone_inactive(building_id: str, zone_id: str, date: str = Query(...)):
    result = remove_zone_inactive(r, building_id, zone_id, date)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.get("/buildings/{building_id}/zones/inactive")
def get_inactive_zones(building_id: str, date: str = Query(None)):
    zones = get_inactive_zones_for_building(r, building_id, date)
    return {"inactive_zones": zones}


@app.get("/buildings/{building_id}/zones/active")
def get_active_zones(building_id: str):
    active_ids = get_active_zone_ids(r, building_id)
    return {"active_zone_ids": active_ids}


# Passenger: current zone
@app.get("/passenger/{surge_id}/zone")
def get_passenger_zone(surge_id: str):
    """
    Public — no auth.
    Returns the passenger's current zone and building from their latest scan.
    """
    if not r.exists(f"surge:{surge_id}"):
        raise HTTPException(
            status_code=404, detail="SURGE ID not found or expired")

    current_zone = r.get(f"surge:{surge_id}:current_zone")

    building_id = None
    scans_raw = r.lrange(f"surge:{surge_id}:scans", 0, 0)
    if scans_raw:
        try:
            latest_scan = json.loads(scans_raw[0])
            building_id = latest_scan.get("building_id")
        except (json.JSONDecodeError, KeyError):
            pass

    return {
        "surge_id":     surge_id,
        "current_zone": current_zone,
        "building_id":  building_id,
    }


# Passenger: full status
@app.get("/passenger/{surge_id}/status")
def get_passenger_status(surge_id: str):
    """
    Public — no auth.
    Returns security/customs/gate wait times and gate congestion level.
    No flight data or boarding simulation — congestion only.
    """
    if not r.exists(f"surge:{surge_id}"):
        raise HTTPException(
            status_code=404, detail="SURGE ID not found or expired")

    current_zone_id = r.get(f"surge:{surge_id}:current_zone")

    building_id = None
    scans_raw = r.lrange(f"surge:{surge_id}:scans", 0, 0)
    if scans_raw:
        try:
            latest_scan = json.loads(scans_raw[0])
            building_id = latest_scan.get("building_id")
        except (json.JSONDecodeError, KeyError):
            pass

    if not building_id:
        return {
            "status":                "awaiting_scan",
            "security_wait_minutes": None,
            "customs_wait_minutes":  None,
            "gates":                 [],
            "current_zone_id":       None,
            "current_zone_type":     None,
            "current_zone_name":     None,
            "building_id":           None,
            "congestion_level":      None,
        }

    config_raw = r.get(f"surge:building:{building_id}:config")
    if not config_raw:
        raise HTTPException(
            status_code=404, detail="Building config not found")

    config = json.loads(config_raw)
    zones = config.get("zones", [])
    zone_map = {z["zone_id"]: z for z in zones}

    congestion_data = get_zone_congestion(r, building_id)
    zone_congestion = congestion_data.get("zones", {})

    def best_wait_for_type(zone_type: str):
        matches = [z for z in zones if z.get("zone_type") == zone_type]
        if not matches:
            return None
        waits = [
            zone_congestion[z["zone_id"]]["estimated_wait_minutes"]
            for z in matches
            if z["zone_id"] in zone_congestion
            and zone_congestion[z["zone_id"]].get("estimated_wait_minutes") is not None
        ]
        return round(min(waits), 1) if waits else None

    security_wait = best_wait_for_type("security")
    customs_wait = best_wait_for_type("customs")

    def get_gates_breakdown():
        """Returns list of all gate zones with individual wait times and congestion."""
        gate_zones_list = [z for z in zones if z.get("zone_type") == "gate"]
        result = []
        for z in gate_zones_list:
            cong = zone_congestion.get(z["zone_id"], {})
            result.append({
                "zone_id":          z["zone_id"],
                "zone_name":        z["zone_name"],
                "wait_minutes":     cong.get("estimated_wait_minutes"),
                "congestion_level": cong.get("congestion_level"),
                "active_passengers": cong.get("active_passengers", 0),
            })
        result.sort(key=lambda x: x["wait_minutes"]
                    if x["wait_minutes"] is not None else 999)
        return result

    gates = get_gates_breakdown()

    current_zone_meta = zone_map.get(current_zone_id, {})
    current_zone_type = current_zone_meta.get("zone_type")
    current_zone_name = current_zone_meta.get("zone_name")
    current_cong = zone_congestion.get(current_zone_id, {})
    current_level = current_cong.get("congestion_level")

    return {
        "status":                "active",
        "security_wait_minutes": security_wait,
        "customs_wait_minutes":  customs_wait,
        "gates":                 gates,
        "current_zone_id":       current_zone_id,
        "current_zone_type":     current_zone_type,
        "current_zone_name":     current_zone_name,
        "building_id":           building_id,
        "congestion_level":      current_level,
    }


# Passenger: public building config
@app.get("/passenger/building/{building_id}/config")
def get_building_config_public(building_id: str):
    """
    Public read-only config for the passenger UI.
    Strips owner_id — no auth required.
    """
    config_raw = r.get(f"surge:building:{building_id}:config")
    if not config_raw:
        raise HTTPException(status_code=404, detail="Building not found")

    config = json.loads(config_raw)

    return {
        "building_id":   config.get("building_id"),
        "building_name": config.get("building_name"),
        "floors":        config.get("floors", []),
        "incentives":    config.get("incentives", {}),
        "zones": [
            {
                "zone_id":   z.get("zone_id"),
                "zone_name": z.get("zone_name"),
                "zone_type": z.get("zone_type"),
                "floor_id":  z.get("floor_id"),
            }
            for z in config.get("zones", [])
        ],
    }


# Airport: live terminal status
@app.get("/airport/{building_id}/live")
def get_airport_live(building_id: str):
    """
    Powers the pre-scan view. Same response shape as /passenger/{id}/status
    so the frontend just uses identical render logic for both states.
    """
    config_raw = r.get(f"surge:building:{building_id}:config")
    if not config_raw:
        raise HTTPException(status_code=404, detail="Building not found")

    config = json.loads(config_raw)
    zones = config.get("zones", [])

    congestion_data = get_zone_congestion(r, building_id)
    zone_congestion = congestion_data.get("zones", {})

    def best_wait_for_type(zone_type: str):
        matches = [z for z in zones if z.get("zone_type") == zone_type]
        if not matches:
            return None
        waits = [
            zone_congestion[z["zone_id"]]["estimated_wait_minutes"]
            for z in matches
            if z["zone_id"] in zone_congestion
            and zone_congestion[z["zone_id"]].get("estimated_wait_minutes") is not None
        ]
        return round(min(waits), 1) if waits else None

    security_wait = best_wait_for_type("security")
    customs_wait = best_wait_for_type("customs")

    def get_gates_breakdown():
        """Returns list of all gate zones with individual wait times and congestion."""
        gate_zones_list = [z for z in zones if z.get("zone_type") == "gate"]
        result = []
        for z in gate_zones_list:
            cong = zone_congestion.get(z["zone_id"], {})
            result.append({
                "zone_id":          z["zone_id"],
                "zone_name":        z["zone_name"],
                "wait_minutes":     cong.get("estimated_wait_minutes"),
                "congestion_level": cong.get("congestion_level"),
                "active_passengers": cong.get("active_passengers", 0),
            })
        result.sort(key=lambda x: x["wait_minutes"]
                    if x["wait_minutes"] is not None else 999)
        return result

    gates = get_gates_breakdown()

    return {
        "status":                "live",
        "security_wait_minutes": security_wait,
        "customs_wait_minutes":  customs_wait,
        "gates":                 gates,
        "current_zone_id":       None,
        "current_zone_type":     None,
        "current_zone_name":     None,
        "building_id":           building_id,
        "congestion_level":      None,
    }


# Airport: valid zone types
@app.get("/airport/zone-types")
def get_valid_zone_types():
    """
    Returns the list of valid airport zone types for frontend dropdowns.
    """
    return {
        "zone_types": [
            {"zone_type": k, "label": v}
            for k, v in AIRPORT_ZONE_TYPES.items()
        ]
    }


# Fastest Route Recommendation

@app.get("/airport/{building_id}/recommend/{zone_type}")
def get_route_recommendation(building_id: str, zone_type: str):
    """
    Compares all zones of the requested type by:
      1. congestion_score  (primary sort — lower is better)
      2. estimated_wait_minutes (queue length proxy)

    Walking distance excluded — not available in current data model.

    Returns a ranked list and a single recommended zone.

    zone_type must be one of the valid airport zone types.
    """
    if zone_type not in VALID_ZONE_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid zone_type '{zone_type}'. Must be one of: {', '.join(sorted(VALID_ZONE_TYPES))}"
        )

    config_raw = r.get(f"surge:building:{building_id}:config")
    if not config_raw:
        raise HTTPException(status_code=404, detail="Building not found")

    config = json.loads(config_raw)
    zones = config.get("zones", [])

    target_zones = [z for z in zones if z.get("zone_type") == zone_type]

    if not target_zones:
        raise HTTPException(
            status_code=404,
            detail=f"No zones of type '{zone_type}' found in this building"
        )

    congestion_data = get_zone_congestion(r, building_id)
    zone_congestion = congestion_data.get("zones", {})

    ranked = []
    for z in target_zones:
        cong = zone_congestion.get(z["zone_id"], {})
        score = cong.get("congestion_score", 0) or 0
        wait = cong.get("estimated_wait_minutes")
        level = cong.get("congestion_level", "LOW")
        queue = cong.get("active_passengers", 0) or 0

        total_time = round(wait, 1) if wait is not None else None

        ranked.append({
            "zone_id":                z["zone_id"],
            "zone_name":              z["zone_name"],
            "congestion_score":       round(score, 1),
            "wait_minutes":           total_time,
            "total_travel_time_minutes": total_time,
            "congestion_level":       level,
            "queue_length":           queue,
        })

    ranked.sort(key=lambda x: (
        x["wait_minutes"] if x["wait_minutes"] is not None else 999,
        x["congestion_score"]
    ))

    recommended = ranked[0] if ranked else None

    return {
        "zone_type":     zone_type,
        "zone_label":    get_zone_label(zone_type),
        "building_id":   building_id,
        "options":       ranked,
        "recommended":   recommended,
    }


# Virtual Queue System

def get_queue_key(building_id: str, zone_id: str) -> str:
    return f"queue:{building_id}:{zone_id}"


def get_queue_meta_key(building_id: str, zone_id: str) -> str:
    return f"queue:{building_id}:{zone_id}:meta"


def compute_estimated_wait(position: int, avg_processing_time: float) -> float:
    """
    position is 0-indexed (0 = next to be served).
    avg_processing_time is in minutes.
    """
    return round(position * avg_processing_time, 1)


@app.get("/queue/{building_id}/{zone_id}/status")
def get_queue_status(building_id: str, zone_id: str, surge_id: str = Query(...)):
    """Public — returns passenger's current queue position."""
    queue_key = get_queue_key(building_id, zone_id)
    meta_key = get_queue_meta_key(building_id, zone_id)

    queue_members = r.lrange(queue_key, 0, -1)
    current_queue_size = len(queue_members)
    meta = r.hgetall(meta_key)
    avg_processing_time = float(meta.get("avg_processing_time", 2.0))

    if surge_id not in queue_members:
        return {
            "in_queue":               False,
            "queue_position":         None,
            "current_queue_size":     current_queue_size,
            "estimated_wait_minutes": None,
            "avg_processing_time":    avg_processing_time,
        }

    position_0indexed = queue_members.index(surge_id)
    queue_position = position_0indexed + 1
    estimated_wait = compute_estimated_wait(
        position_0indexed, avg_processing_time)

    return {
        "in_queue":               True,
        "queue_position":         queue_position,
        "current_queue_size":     current_queue_size,
        "estimated_wait_minutes": estimated_wait,
        "avg_processing_time":    avg_processing_time,
    }


@app.post("/queue/{building_id}/{zone_id}/join")
def join_queue(building_id: str, zone_id: str, request: QueueJoinRequest):
    surge_id = request.surge_id

    if not r.exists(f"surge:{surge_id}"):
        raise HTTPException(
            status_code=404, detail="SURGE ID not found or expired")

    config_raw = r.get(f"surge:building:{building_id}:config")
    if not config_raw:
        raise HTTPException(status_code=404, detail="Building not found")

    config = json.loads(config_raw)
    zones = config.get("zones", [])
    zone = next((z for z in zones if z["zone_id"] == zone_id), None)

    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    queue_key = get_queue_key(building_id, zone_id)
    meta_key = get_queue_meta_key(building_id, zone_id)

    queue_members = r.lrange(queue_key, 0, -1)
    already_in = surge_id in queue_members

    if not already_in:
        r.rpush(queue_key, surge_id)
        r.expire(queue_key, 7200)

        if not r.exists(meta_key):
            r.hset(meta_key, mapping={
                "avg_processing_time": 2.0,
                "created_at":          datetime.utcnow().isoformat()
            })
            r.expire(meta_key, 7200)

    queue_members = r.lrange(queue_key, 0, -1)
    position_0indexed = queue_members.index(
        surge_id) if surge_id in queue_members else 0
    queue_position = position_0indexed + 1
    current_queue_size = len(queue_members)
    meta = r.hgetall(meta_key)
    avg_processing_time = float(meta.get("avg_processing_time", 2.0))
    estimated_wait = compute_estimated_wait(
        position_0indexed, avg_processing_time)

    return {
        "surge_id":               surge_id,
        "queue_id":               f"{building_id}:{zone_id}",
        "location_id":            zone_id,
        "zone_name":              zone.get("zone_name", zone_id),
        "queue_position":         queue_position,
        "current_queue_size":     current_queue_size,
        "estimated_wait_minutes": estimated_wait,
        "already_in_queue":       already_in,
    }


@app.delete("/queue/{building_id}/{zone_id}/leave")
def leave_queue(building_id: str, zone_id: str, surge_id: str = Query(...)):
    """Public — removes passenger from queue."""
    queue_key = get_queue_key(building_id, zone_id)
    removed = r.lrem(queue_key, 0, surge_id)
    return {
        "success":  removed > 0,
        "surge_id": surge_id,
        "removed":  removed > 0,
    }


@app.get("/queue/{building_id}/{zone_id}")
def get_queue_state(building_id: str, zone_id: str):
    """Public — returns full queue state for a single zone."""
    config_raw = r.get(f"surge:building:{building_id}:config")
    if not config_raw:
        raise HTTPException(status_code=404, detail="Building not found")

    config = json.loads(config_raw)
    zones = config.get("zones", [])
    zone = next((z for z in zones if z["zone_id"] == zone_id), None)

    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    queue_key = get_queue_key(building_id, zone_id)
    meta_key = get_queue_meta_key(building_id, zone_id)
    current_size = r.llen(queue_key)
    meta = r.hgetall(meta_key)
    avg_processing_time = float(meta.get("avg_processing_time", 2.0))

    return {
        "queue_id":            f"{building_id}:{zone_id}",
        "location_id":         zone_id,
        "building_id":         building_id,
        "zone_name":           zone.get("zone_name", zone_id),
        "zone_type":           zone.get("zone_type"),
        "current_queue_size":  current_size,
        "avg_processing_time": avg_processing_time,
        "is_active":           True,
    }


@app.get("/queue/{building_id}")
def get_all_queues(building_id: str):
    """Public — returns queue state for all zones in a building."""
    config_raw = r.get(f"surge:building:{building_id}:config")
    if not config_raw:
        raise HTTPException(status_code=404, detail="Building not found")

    config = json.loads(config_raw)
    zones = config.get("zones", [])

    queues = []
    for zone in zones:
        zone_id = zone["zone_id"]
        queue_key = get_queue_key(building_id, zone_id)
        meta_key = get_queue_meta_key(building_id, zone_id)
        size = r.llen(queue_key)
        meta = r.hgetall(meta_key)
        avg = float(meta.get("avg_processing_time", 2.0))

        queues.append({
            "queue_id":            f"{building_id}:{zone_id}",
            "location_id":         zone_id,
            "zone_name":           zone.get("zone_name", zone_id),
            "zone_type":           zone.get("zone_type"),
            "current_queue_size":  size,
            "avg_processing_time": avg,
        })

    return {"building_id": building_id, "queues": queues}


# Passenger Density Estimation

@app.get("/airport/{building_id}/density")
def get_passenger_density(building_id: str):
    """
    This assumes 40% of real passengers scan a QR code at each checkpoint.
    Returns per-zone density estimates plus a building-wide summary.
    """
    config_raw = r.get(f"surge:building:{building_id}:config")
    if not config_raw:
        raise HTTPException(status_code=404, detail="Building not found")

    config = json.loads(config_raw)
    zones = config.get("zones", [])

    congestion_data = get_zone_congestion(r, building_id)
    zone_congestion = congestion_data.get("zones", {})

    zone_estimates = []
    total_scans_detected = 0
    total_estimated_passengers = 0

    for zone in zones:
        zone_id = zone["zone_id"]
        cong = zone_congestion.get(zone_id, {})

        scans_detected = cong.get("active_passengers", 0) or 0

        estimated_total = round(
            scans_detected / PARTICIPATION_RATE) if scans_detected > 0 else 0

        if scans_detected == 0:
            confidence = "none"
        elif scans_detected < 5:
            confidence = "low"
        elif scans_detected < 20:
            confidence = "medium"
        else:
            confidence = "high"

        total_scans_detected += scans_detected
        total_estimated_passengers += estimated_total

        zone_estimates.append({
            "zone_id":               zone_id,
            "zone_name":             zone.get("zone_name"),
            "zone_type":             zone.get("zone_type"),
            "scans_detected":        scans_detected,
            "participation_rate":    PARTICIPATION_RATE,
            "estimated_passengers":  estimated_total,
            "congestion_level":      cong.get("congestion_level"),
            "confidence":            confidence,
        })

    zone_estimates.sort(key=lambda x: x["estimated_passengers"], reverse=True)

    return {
        "building_id":                  building_id,
        "participation_rate":           PARTICIPATION_RATE,
        "total_scans_detected":         total_scans_detected,
        "total_estimated_passengers":   total_estimated_passengers,
        "zones":                        zone_estimates,
        "note": (
            "Estimates based on scan participation only. "
            "WiFi density and security throughput inputs not yet connected."
        ),
    }


# Staff Scan Tool

@app.post("/staff/scan")
def staff_scan(request: StaffScanRequest, authorization: str = Header(None)):
    user_id = verify_token(authorization)

    building_id = request.building_id
    zone_id = request.zone_id
    passenger_count = request.passenger_count

    if passenger_count < 0:
        raise HTTPException(
            status_code=422, detail="passenger_count must be >= 0")

    if passenger_count > 5000:
        raise HTTPException(
            status_code=422, detail="passenger_count must be <= 5000")

    config_raw = r.get(f"surge:building:{building_id}:config")
    if not config_raw:
        raise HTTPException(status_code=404, detail="Building not found")

    config = json.loads(config_raw)
    zones = config.get("zones", [])
    zone = next((z for z in zones if z["zone_id"] == zone_id), None)

    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    staff_pool_key = f"staff:scans:{building_id}:{zone_id}"
    old_ids = r.lrange(staff_pool_key, 0, -1)
    for old_id in old_ids:
        r.delete(f"surge:{old_id}")
        r.delete(f"surge:{old_id}:scans")
        r.delete(f"surge:{old_id}:current_zone")
    r.delete(staff_pool_key)

    import uuid
    timestamp = datetime.utcnow().isoformat()
    new_ids = []

    for _ in range(passenger_count):
        surge_id = f"staff-{uuid.uuid4()}"
        scan_data = {
            "zone":        zone_id,
            "building_id": building_id,
            "timestamp":   timestamp,
        }
        r.set(f"surge:{surge_id}", "active", ex=3600)
        r.rpush(f"surge:{surge_id}:scans", json.dumps(scan_data))
        r.set(f"surge:{surge_id}:current_zone", zone_id, ex=3600)
        r.expire(f"surge:{surge_id}:scans", 3600)
        new_ids.append(surge_id)

    if new_ids:
        r.rpush(staff_pool_key, *new_ids)
        r.expire(staff_pool_key, 3600)

    return {
        "success":          True,
        "building_id":      building_id,
        "zone_id":          zone_id,
        "zone_name":        zone.get("zone_name"),
        "passenger_count":  passenger_count,
        "staff_id":         user_id,
        "timestamp":        timestamp,
        "message":          f"Recorded {passenger_count} passengers in {zone.get('zone_name', zone_id)}",
    }


@app.get("/staff/zones/{building_id}")
def get_staff_zones(building_id: str, authorization: str = Header(None)):
    """
    Auth required — returns all zones with current congestion for the
    staff scan tool zone selector.
    """
    verify_token(authorization)

    config_raw = r.get(f"surge:building:{building_id}:config")
    if not config_raw:
        raise HTTPException(status_code=404, detail="Building not found")

    config = json.loads(config_raw)
    zones = config.get("zones", [])
    congestion_data = get_zone_congestion(r, building_id)
    zone_congestion = congestion_data.get("zones", {})

    return {
        "building_id": building_id,
        "zones": [
            {
                "zone_id":           z["zone_id"],
                "zone_name":         z["zone_name"],
                "zone_type":         z.get("zone_type"),
                "floor_id":          z.get("floor_id"),
                "congestion_level":  zone_congestion.get(z["zone_id"], {}).get("congestion_level", "LOW"),
                "active_passengers": zone_congestion.get(z["zone_id"], {}).get("active_passengers", 0),
            }
            for z in zones
        ],
    }
