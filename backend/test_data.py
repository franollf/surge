# Test Data Generator for SURGE
# This creates fake scan data to test congestion levels

import redis
import json
from datetime import datetime, timedelta
from uuid import uuid4
import random
import os
from dotenv import load_dotenv

load_dotenv()

REDIS_HOST = os.getenv("REDIS_HOST")
REDIS_PORT = os.getenv("REDIS_PORT")

r = redis.Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    decode_responses=True
)

DEFAULT_BUILDING_ID = "airport-yvr"


def load_building_config(building_id: str) -> dict:
    raw = r.get(f"surge:building:{building_id}:config")
    if not raw:
        raise RuntimeError(
            f"Building config not found for building_id='{building_id}'. "
            f"Create/save it first via POST /buildings/{building_id}/config."
        )
    return json.loads(raw)


def resolve_zone_id(config: dict, zone: str) -> str:
    """
    Accepts either a zone_id or a human zone_name and returns the zone_id.

    Matching rules:
    - exact match on zone_id
    - case-insensitive match on zone_name
    - case-insensitive match on zone_id (helpful for simple ids)
    """
    zones = config.get("zones") or []
    if not zones:
        raise RuntimeError("Building config has no zones[]")

    # exact zone_id
    for z in zones:
        if z.get("zone_id") == zone:
            return z["zone_id"]

    # case-insensitive zone_name
    zone_lower = zone.strip().lower()
    for z in zones:
        if (z.get("zone_name") or "").strip().lower() == zone_lower:
            return z["zone_id"]

    # case-insensitive zone_id
    for z in zones:
        if (z.get("zone_id") or "").strip().lower() == zone_lower:
            return z["zone_id"]

    available = ", ".join(
        [f'{z.get("zone_name", "?")}({z.get("zone_id", "?")})' for z in zones]
    )
    raise RuntimeError(
        f"Could not resolve zone '{zone}'. Available zones: {available}"
    )


def create_congestion_at_zone(
    zone: str,
    num_passengers: int = 20,
    building_id: str = DEFAULT_BUILDING_ID
):
    """
    Create heavy congestion at a specific zone with RECENT scans,
    scoped to a building_id and using a zone_id from that building config.
    """
    config = load_building_config(building_id)
    zone_id = resolve_zone_id(config, zone)

    all_zone_ids = [z["zone_id"]
                    for z in (config.get("zones") or []) if z.get("zone_id")]
    if not all_zone_ids:
        raise RuntimeError(
            "No zone_id values found in building config zones[]")

    print(f"\n🔥 Creating congestion at zone='{zone}' (zone_id='{zone_id}')")
    print(f"   building_id='{building_id}', passengers={num_passengers}")

    created_ids = []
    for i in range(num_passengers):
        surge_id = str(uuid4())
        created_ids.append(surge_id)
        r.set(f"surge:{surge_id}", "active", ex=3600)

        now = datetime.utcnow()

        # Entry scan 1-4 minutes ago
        entry_time = now - timedelta(
            minutes=random.randint(1, 4),
            seconds=random.randint(0, 59)
        )

        # Previous zone in SAME building (choose a different zone_id if possible)
        prev_zone_candidates = [
            zid for zid in all_zone_ids if zid != zone_id] or [zone_id]
        prev_zone_id = random.choice(prev_zone_candidates)

        scan1 = {
            "zone": prev_zone_id,
            "building_id": building_id,
            "timestamp": (entry_time - timedelta(minutes=random.randint(2, 5))).isoformat()
        }

        scan2 = {
            "zone": zone_id,
            "building_id": building_id,
            "timestamp": entry_time.isoformat()
        }

        scan3 = {
            "zone": zone_id,
            "building_id": building_id,
            "timestamp": (entry_time + timedelta(seconds=random.randint(30, 180))).isoformat()
        }

        r.lpush(f"surge:{surge_id}:scans", json.dumps(scan1))
        r.lpush(f"surge:{surge_id}:scans", json.dumps(scan2))
        r.lpush(f"surge:{surge_id}:scans", json.dumps(scan3))
        r.set(f"surge:{surge_id}:current_zone", zone_id, ex=3600)
        r.expire(f"surge:{surge_id}:scans", 3600)

        if (i + 1) % 10 == 0:
            print(f"  Created {i + 1}/{num_passengers} passengers...")

    formatted_ids = ", ".join(f'"{sid}"' for sid in created_ids)
    print("\n📦 Generated SURGE IDs:")
    print(f"{{ {formatted_ids} }}")
    print(f"✅ Created {num_passengers} passengers in {building_id}:{zone_id}")


def clear_all_test_data():
    """
    Clear TEST data from Redis, but preserve recent real passenger IDs
    """
    print("\n🗑️  Clearing test data (keeping recent real passengers)...")

    cursor = 0
    deleted = 0
    kept = 0

    all_keys = []
    while True:
        cursor, keys = r.scan(cursor, match="surge:*", count=100)
        all_keys.extend(keys)
        if cursor == 0:
            break

    surge_ids_with_ttl = []
    for key in all_keys:
        if ":" not in key[6:]:
            surge_id = key.replace("surge:", "")
            ttl = r.ttl(key)
            if ttl > 0:
                surge_ids_with_ttl.append((surge_id, ttl))

    surge_ids_with_ttl.sort(key=lambda x: x[1], reverse=True)

    keep_ids = set([sid for sid, _ in surge_ids_with_ttl[:3]])

    if keep_ids:
        print("🔒 Keeping these real passenger IDs:")
        for sid in keep_ids:
            print(f"   - {sid[:8]}... (TTL: {r.ttl(f'surge:{sid}')}s)")

    for key in all_keys:
        should_delete = True
        for keep_id in keep_ids:
            if keep_id in key:
                should_delete = False
                break

        if should_delete:
            r.delete(key)
            deleted += 1
        else:
            kept += 1

    print(f"✅ Deleted {deleted} test keys, kept {kept} real passenger keys")


if __name__ == "__main__":
    print("=" * 60)
    print("SURGE Test Data Generator")
    print("=" * 60)

    # Example: create 200 people in airport-yvr at the cafeteria zone
    create_congestion_at_zone(
        "security", num_passengers=1000, building_id="airport-x")

    print("\n" + "=" * 60)
    print("✅ Test data generation complete!")
    print("=" * 60)
