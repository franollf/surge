# ─────────────────────────────────────────────────────────────────────────────
# backend/airport_zones.py
#
# Single source of truth for valid airport zone types.
# Import this in main.py and any other backend file that needs zone validation.
# ─────────────────────────────────────────────────────────────────────────────

AIRPORT_ZONE_TYPES = {
    "terminal_entry": "Terminal Entry",
    "security":       "Security Access",
    "customs":        "Customs Corridors",
    "gate":           "Boarding Gates",
    "transfer":       "Transfer Points",
    "amenity":        "Amenity Access",
}

VALID_ZONE_TYPES = set(AIRPORT_ZONE_TYPES.keys())

# ─────────────────────────────────────────────
# Passenger Density Estimation
# ─────────────────────────────────────────────
# The % of real passengers estimated to scan a QR code.
# 0.4 = 40% participation (airport industry baseline).
# Update this when the airport operator provides real participation data,
# or once WiFi density / security throughput inputs become available.
PARTICIPATION_RATE = 0.4


def validate_zone_type(zone_type: str) -> bool:
    """Returns True if zone_type is a valid airport zone."""
    return zone_type in VALID_ZONE_TYPES


def get_zone_label(zone_type: str) -> str:
    """Returns the human-readable label for a zone_type."""
    return AIRPORT_ZONE_TYPES.get(zone_type, zone_type)


def validate_building_zones(zones: list) -> list[str]:
    """
    Returns a list of error strings (empty = all valid)
    """
    errors = []
    for i, zone in enumerate(zones):
        zone_type = zone.get("zone_type", "")
        zone_name = zone.get("zone_name", f"Zone {i+1}")
        if not zone_type:
            errors.append(f"Zone '{zone_name}' is missing a zone_type.")
        elif not validate_zone_type(zone_type):
            errors.append(
                f"Zone '{zone_name}' has invalid zone_type '{zone_type}'. "
                f"Must be one of: {', '.join(sorted(VALID_ZONE_TYPES))}"
            )
    return errors
