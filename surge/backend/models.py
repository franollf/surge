
from dataclasses import dataclass
# A dataclass is a python feature that helps you create simple "data holder" classes without writing a ton of boilerplate
# @dataclass generated the __init__ for you automatically
from datetime import datetime
from uuid import UUID

# SURGE ID Data Model

# Our model needs
# id, time created, expiry time


@dataclass
class SurgeID:
    id: UUID  # MAKES THE UNIQUE UNIVERSAL IDENTIFIER
    created_at: datetime
    expires_at: datetime
