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

ZONES = ["terminal_entry", "security", "customs",
         "boarding_gate", "transfer", "amenities"]


def create_congestion_at_zone(zone_name, num_passengers=20):
    """
    Create heavy congestion at a specific zone with RECENT scans
    """
    print(
        f"\n🔥 Creating congestion at {zone_name} with {num_passengers} passengers...")

    created_ids = []
    for i in range(num_passengers):
        surge_id = str(uuid4())
        created_ids.append(surge_id)
        r.set(f"surge:{surge_id}", "active", ex=3600)

        # Create RECENT scans (within last 5 minutes)
        now = datetime.utcnow()  # ✅ CHANGED: Use UTC!

        # Entry scan 1-4 minutes ago
        entry_time = now - \
            timedelta(minutes=random.randint(1, 4),
                      seconds=random.randint(0, 59))

        # Previous zone (they came from somewhere)
        prev_zone = random.choice([z for z in ZONES if z != zone_name])
        scan1 = {
            "zone": prev_zone,
            "timestamp": (entry_time - timedelta(minutes=random.randint(2, 5))).isoformat()
        }

        # Current zone scan (RECENT - within last 5 minutes)
        scan2 = {
            "zone": zone_name,
            "timestamp": entry_time.isoformat()
        }

        # Add one more recent scan at the same zone (still there)
        scan3 = {
            "zone": zone_name,
            "timestamp": (entry_time + timedelta(seconds=random.randint(30, 180))).isoformat()
        }

        r.lpush(f"surge:{surge_id}:scans", json.dumps(scan1))
        r.lpush(f"surge:{surge_id}:scans", json.dumps(scan2))
        r.lpush(f"surge:{surge_id}:scans", json.dumps(scan3))
        r.set(f"surge:{surge_id}:current_zone", zone_name, ex=3600)
        r.expire(f"surge:{surge_id}:scans", 3600)

        if (i + 1) % 10 == 0:  # Progress indicator
            print(f"  Created {i + 1}/{num_passengers} passengers...")

    formatted_ids = ", ".join(f'"{sid}"' for sid in created_ids)
    print("\n📦 Generated SURGE IDs:")
    print(f"{{ {formatted_ids} }}")
    print(f"✅ Created {num_passengers} passengers at {zone_name}")


def clear_all_test_data():
    """
    Clear TEST data from Redis, but preserve recent real passenger IDs
    """
    print("\n🗑️  Clearing test data (keeping recent real passengers)...")

    cursor = 0
    deleted = 0
    kept = 0

    # Get all surge keys
    all_keys = []
    while True:
        cursor, keys = r.scan(cursor, match="surge:*", count=100)
        all_keys.extend(keys)
        if cursor == 0:
            break

    # Find base SURGE IDs and sort by TTL (most recent have highest TTL)
    surge_ids_with_ttl = []
    for key in all_keys:
        # Only look at base surge ID keys (not :scans, :current_zone, etc.)
        if ":" not in key[6:]:  # surge:UUID (no additional :suffix)
            surge_id = key.replace("surge:", "")
            ttl = r.ttl(key)
            if ttl > 0:
                surge_ids_with_ttl.append((surge_id, ttl))

    # Sort by TTL (highest = most recent)
    surge_ids_with_ttl.sort(key=lambda x: x[1], reverse=True)

    # Keep the 3 most recent IDs (real passengers)
    keep_ids = set([sid for sid, _ in surge_ids_with_ttl[:3]])

    if keep_ids:
        print(f"🔒 Keeping these real passenger IDs:")
        for sid in keep_ids:
            print(f"   - {sid[:8]}... (TTL: {r.ttl(f'surge:{sid}')}s)")

    # Delete everything except the ones we're keeping
    for key in all_keys:
        should_delete = True
        for keep_id in keep_ids:
            if keep_id in key:  # Matches surge:ID, surge:ID:scans, etc.
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

    # Create 100 people at terminal_entry
    create_congestion_at_zone("boarding_gate", num_passengers=200)

    print("\n" + "=" * 60)
    print("✅ Test data generation complete!")
    print("=" * 60)
    print("\n🔍 Check congestion levels at: http://localhost:8000/zones")
    print("🔍 Or refresh your passenger frontend!\n")
