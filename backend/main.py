# Surge Main.py
# this creates the web server
# fastapi will handle the routing + HTTP requests + responses
from congestion import get_zone_congestion
from fastapi import FastAPI, HTTPException
# fastapi.responses lets us return file-like-data
from fastapi.responses import StreamingResponse
from storage import create_surge_id
from qr import generate_qr_code
from datetime import datetime
# redis is a temporary system memory
# that we will use to store the Active SURGE_IDS and Scan Event Lists
import redis
import json
from pydantic import BaseModel
import os
from dotenv import load_dotenv
load_dotenv()


class ScanRequest(BaseModel):
    surge_id: str
    zone: str


app = FastAPI(title="SURGE")

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
# issuing a new surge id and returning its qr code
def issue_surge_id():

    surge = create_surge_id()

    r.set(
        f"surge:{surge.id}",
        "active",
        ex=3600
    )

    qr_buffer = generate_qr_code(str(surge.id))
    print("Issued SURGE ID:", surge.id)

    return StreamingResponse(
        qr_buffer,
        media_type="image/png"
    )


@app.post("/scan")
def scanqrcode(data: ScanRequest):
    surge_id = data.surge_id
    zone = data.zone

    # first we need to check if the surgeid even exists
    if not r.exists(f"surge:{surge_id}"):
        raise HTTPException(
            status_code=404, detail="Invalid or expired SURGE ID")

    # second validate the zone
    if zone not in VALID_ZONES:
        raise HTTPException(status_code=400, detail="Invalid Zone")

    # Check current zone
    scans_key = f"surge:{surge_id}:scans"
    raw_scans = r.lrange(scans_key, 0, -1)

    if raw_scans:
        try:
            current_scan = json.loads(raw_scans[-1])
            if current_scan.get("zone") == zone:
                # Already in this zone
                return {
                    "status": "already_scanned",
                    "message": "You've already scanned in this zone",
                    "surge_id": surge_id,
                    "zone": zone,
                    "current_timestamp": current_scan.get("timestamp")
                }
        except json.JSONDecodeError:
            pass

    # Delete all previous scans (removes from previous zones)
    r.delete(scans_key)

    # Record new scan in the new zone
    timestamp = datetime.utcnow().isoformat()
    scan_event = {
        "zone": zone,
        "timestamp": timestamp
    }

    r.rpush(scans_key, json.dumps(scan_event))

    return {
        "status": "scan recorded",
        "surge_id": surge_id,
        "zone": zone,
        "timestamp": timestamp
    }


@app.get("/congestion")
def get_zone_heatmap():
    """
    Returns anonymized zone-level congestion data.
    No SURGE IDs or personal data exposed.
    """
    return get_zone_congestion(r)
