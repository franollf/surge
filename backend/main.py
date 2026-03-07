# Surge Main.py
from congestion import get_zone_congestion
from fastapi import FastAPI, HTTPException, Query
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


class ZoneScheduleRequest(BaseModel):
    building_id: str
    zone_id: str
    date: str  # YYYY-MM-DD format


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
# Save Building Config
# ─────────────────────────────────────────────
@app.post("/buildings/{building_id}/config")
def save_building_config(building_id: str, config: BuildingConfig):

    r.set(
        f"surge:building:{building_id}:config",
        json.dumps(config.dict())
    )

    return {"success": True}


# ─────────────────────────────────────────────
# Get Building Config
# ─────────────────────────────────────────────
@app.get("/buildings/{building_id}/config")
def get_building_config(building_id: str):

    raw = r.get(f"surge:building:{building_id}:config")

    if not raw:
        raise HTTPException(status_code=404, detail="No config found")

    return json.loads(raw)


# ─────────────────────────────────────────────
# Scan Passenger
# ─────────────────────────────────────────────
@app.post("/scan")
def scan_checkpoint(scan: ScanRequest):

    # Verify SURGE ID exists
    status = r.get(f"surge:{scan.surge_id}")

    if not status:
        raise HTTPException(
            status_code=404,
            detail="Invalid or expired SURGE ID"
        )

    # Load building config
    config_raw = r.get(
        f"surge:building:{scan.building_id}:config"
    )

    if not config_raw:
        raise HTTPException(
            status_code=404,
            detail="Building config not found"
        )

    config = json.loads(config_raw)

    valid_zone_ids = {z["zone_id"] for z in config["zones"]}

    if scan.zone_id not in valid_zone_ids:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid zone_id: {scan.zone_id}"
        )

    # Check if the zone is currently inactive
    if not is_zone_active(r, scan.building_id, scan.zone_id):
        raise HTTPException(
            status_code=403,
            detail=f"Zone '{scan.zone_id}' is currently inactive and not accepting scans"
        )

    # Update passenger zone
    r.set(
        f"surge:{scan.surge_id}:current_zone",
        scan.zone_id,
        ex=3600
    )

    r.set(f"surge:{scan.surge_id}:current_building", scan.building_id, ex=3600)

    # Log scan event
    scan_event = {
        "zone": scan.zone_id,
        "building_id": scan.building_id,
        "timestamp": datetime.utcnow().isoformat()
    }

    r.lpush(
        f"surge:{scan.surge_id}:scans",
        json.dumps(scan_event)
    )
    r.expire(f"surge:{scan.surge_id}:scans", 3600)

    return {
        "success": True,
        "surge_id": scan.surge_id,
        "current_zone": scan.zone_id
    }


# ─────────────────────────────────────────────
# Bulk Scan
# ─────────────────────────────────────────────
@app.post("/scan/bulk")
def scan_multiple_passengers(scan: BulkScanRequest):

    config_raw = r.get(
        f"surge:building:{scan.building_id}:config"
    )

    if not config_raw:
        raise HTTPException(
            status_code=404,
            detail="Building config not found"
        )

    config = json.loads(config_raw)
    valid_zone_ids = {z["zone_id"] for z in config["zones"]}

    if scan.zone_id not in valid_zone_ids:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid zone_id: {scan.zone_id}"
        )

    updated = []
    failed = []

    for surge_id in scan.surge_ids:

        status = r.get(f"surge:{surge_id}")

        if not status:
            failed.append(surge_id)
            continue

        r.set(
            f"surge:{surge_id}:current_zone",
            scan.zone_id,
            ex=3600
        )

        scan_event = {
            "zone": scan.zone_id,
            "building_id": scan.building_id,
            "timestamp": datetime.utcnow().isoformat()
        }

        r.lpush(
            f"surge:{surge_id}:scans",
            json.dumps(scan_event)
        )
        r.expire(f"surge:{surge_id}:scans", 3600)

        updated.append(surge_id)

    return {
        "success": True,
        "zone_id": scan.zone_id,
        "updated_count": len(updated),
        "failed_count": len(failed)
    }


# ─────────────────────────────────────────────
# Congestion Endpoint
# ─────────────────────────────────────────────
@app.get("/congestion/{building_id}")
def get_zone_heatmap(building_id: str):
    active_zones = get_active_zone_ids(r, building_id)
    return get_zone_congestion(r, building_id, active_zones=active_zones)


# ─────────────────────────────────────────────
# Passenger Current Zone
# ─────────────────────────────────────────────
@app.get("/passenger/{surge_id}/zone")
def get_passenger_zone(surge_id: str):
    status = r.get(f"surge:{surge_id}")
    if not status:
        raise HTTPException(
            status_code=404, detail="Invalid or expired SURGE ID")

    current_zone = r.get(f"surge:{surge_id}:current_zone") or "unknown"
    current_building = r.get(
        f"surge:{surge_id}:current_building") or "unknown"  # Add this

    return {
        "surge_id": surge_id,
        "current_zone": current_zone,
        "building_id": current_building  # Add this
    }


@app.get("/buildings")
def list_buildings():
    """
    Returns all building IDs stored in Redis.
    """
    cursor = 0
    buildings = []

    while True:
        cursor, keys = r.scan(
            cursor,
            match="surge:building:*:config",
            count=100
        )

        for key in keys:
            building_id = key.split(":")[2]
            buildings.append(building_id)

        if cursor == 0:
            break

    return {"buildings": buildings}


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
def unschedule_zone_inactive(building_id: str, data: ZoneScheduleRequest):
    """
    Remove a previously scheduled inactive date for a zone.
    """
    result = remove_zone_inactive(r, building_id, data.zone_id, data.date)

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    return result


@app.get("/buildings/{building_id}/zones/inactive")
def list_inactive_zones(
    building_id: str,
    date: Optional[str] = Query(
        default=None,
        description="Date in YYYY-MM-DD format. Defaults to today."
    )
):
    """
    List all zones that are scheduled as inactive for a given date.
    """
    inactive = get_inactive_zones_for_building(r, building_id, target_date=date)
    return {
        "building_id": building_id,
        "date": date or "today",
        "inactive_zones": inactive,
        "count": len(inactive)
    }


@app.get("/buildings/{building_id}/zones/active")
def list_active_zones(
    building_id: str,
    date: Optional[str] = Query(
        default=None,
        description="Date in YYYY-MM-DD format. Defaults to today."
    )
):
    """
    Get all zones that are currently active (not scheduled inactive).
    """
    active = get_active_zone_ids(r, building_id, target_date=date)
    return {
        "building_id": building_id,
        "date": date or "today",
        "active_zone_ids": sorted(active),
        "count": len(active)
    }
