# where the surge id's live after they are created
from datetime import datetime
from uuid import uuid4

from config import SURGE_ID_TTL
from models import SurgeID

# make an in memory storage that maps in a dictionary (SURGE_ID => SurgeID Object)

_surge_store: dict[str, SurgeID] = {}

# function to create a surgeID and then store it


def create_surge_id():
    now = datetime.now()
    surge_id = SurgeID(
        id=uuid4(),
        created_at=now,
        expires_at=now + SURGE_ID_TTL
    )

    # store the UUID as a key and the model as its value
    _surge_store[str(surge_id.id)] = surge_id
    return surge_id


# function to retrieve the surge ID if it exists and is not expired

def get_surge_id(surge_id: str):
    record = _surge_store.get(surge_id)

    # if it's not there then return nothing is there
    if not record:
        return None

    # if it's already expired then delete the surge_id out of the storage
    if record.expires_at < datetime.now():
        del _surge_store[surge_id]
        return None

    return record
