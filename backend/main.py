# Surge Main.py
from congestion import get_zone_congestion
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from storage import create_surge_id
from qr import generate_qr_code
from datetime import datetime
import redis
import json
from pydantic import BaseModel
import os
from dotenv import load_dotenv
from typing import List
from pydantic import BaseModel


class BulkScanRequest(BaseModel):
    surge_ids: List[str]
    zone_id: str


load_dotenv()


class ScanRequest(BaseModel):
    surge_id: str
    zone_id: str  # ← FIXED: was "zone", now "zone_id"


app = FastAPI(title="SURGE")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Surge-ID"]
)

REDIS_HOST = os.getenv("REDIS_HOST")
REDIS_PORT = os.getenv("REDIS_PORT")

r = redis.Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    decode_responses=True,
    socket_connect_timeout=2,
    socket_timeout=2
)

VALID_ZONES = {
    "terminal_entry",
    "security",
    "customs",
    "boarding_gate",
    "transfer",
    "amenities"
}


@app.get("/issue")
def issue_surge_id():
    surge = create_surge_id()

    r.set(f"surge:{surge.id}", "active", ex=3600)

    qr_buffer = generate_qr_code(str(surge.id))
    print("Issued SURGE ID:", surge.id)

    return StreamingResponse(
        qr_buffer,
        media_type="image/png",
        headers={"X-Surge-ID": str(surge.id)}
    )


@app.post("/scan")
def scan_checkpoint(scan: ScanRequest):
    """
    Called when a passenger scans their QR code at a checkpoint.
    Updates their current zone and logs scan event for congestion analysis.
    """
    # Verify SURGE ID exists and is active
    status = r.get(f"surge:{scan.surge_id}")

    if not status:
        raise HTTPException(
            status_code=404, detail="Invalid or expired SURGE ID")

    # Validate zone
    if scan.zone_id not in VALID_ZONES:
        raise HTTPException(
            status_code=400, detail=f"Invalid zone_id: {scan.zone_id}")

    # Update current zone (for passenger tracking)
    r.set(
        f"surge:{scan.surge_id}:current_zone",
        scan.zone_id,
        ex=3600
    )

    # Log scan event for congestion analysis (CORRECT FORMAT)
    scan_event = {
        # Note: "zone" not "zone_id" (congestion.py expects this)
        "zone": scan.zone_id,
        "timestamp": datetime.now().isoformat()
    }

    r.lpush(
        f"surge:{scan.surge_id}:scans",  # ✅ Correct key name
        json.dumps(scan_event)  # ✅ Proper JSON format
    )
    r.expire(f"surge:{scan.surge_id}:scans", 3600)

    print(f"SURGE ID {scan.surge_id} scanned at {scan.zone_id}")

    return {
        "success": True,
        "surge_id": scan.surge_id,
        "current_zone": scan.zone_id,
        "message": f"Checked in to {scan.zone_id}"
    }


@app.post("/scan/bulk")
def scan_multiple_passengers(scan: BulkScanRequest):
    """
    Scan multiple passengers into a zone at once.
    Useful for test simulations.
    """

    if scan.zone_id not in VALID_ZONES:
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

        # Update current zone
        r.set(
            f"surge:{surge_id}:current_zone",
            scan.zone_id,
            ex=3600
        )

        # Log scan event
        scan_event = {
            "zone": scan.zone_id,
            "timestamp": datetime.utcnow().isoformat()
        }

        r.lpush(
            f"surge:{surge_id}:scans",
            json.dumps(scan_event)
        )
        r.expire(f"surge:{surge_id}:scans", 3600)

        updated.append(surge_id)

    print(f"Bulk scan: {len(updated)} passengers → {scan.zone_id}")

    return {
        "success": True,
        "zone_id": scan.zone_id,
        "updated_count": len(updated),
        "failed_count": len(failed),
        "updated_ids": updated,
        "failed_ids": failed
    }


@app.get("/zones")  # ← ADDED: This endpoint was missing!
def get_zones():
    """
    Returns congestion data for all zones.
    Frontend expects this endpoint at /zones
    """
    return get_zone_congestion(r)


@app.get("/congestion")
def get_zone_heatmap():
    """
    Alternative endpoint name for congestion data
    """
    return get_zone_congestion(r)


@app.get("/passenger/{surge_id}/zone")
def get_passenger_zone(surge_id: str):
    """
    Returns the current zone for a given SURGE ID.
    """
    # Check if SURGE ID is valid
    status = r.get(f"surge:{surge_id}")

    if not status:
        raise HTTPException(
            status_code=404, detail="Invalid or expired SURGE ID")

    # Get current zone
    current_zone = r.get(f"surge:{surge_id}:current_zone")

    if not current_zone:
        # Default to terminal_entry if never scanned
        current_zone = "terminal_entry"

    return {
        "surge_id": surge_id,
        "current_zone": current_zone
    }
