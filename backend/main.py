# Surge Main.py
# this creates the web server
# fastapi will handle the routing + HTTP requests + responses
from fastapi import FastAPI
# fastapi.responses lets us return file-like-data
from fastapi.responses import StreamingResponse

from storage import create_surge_id
from qr import generate_qr_code

app = FastAPI(title="SURGE")


@app.get("/issue")
# issuing a new surge id and returning its qr code
def issue_surge_id():

    surge = create_surge_id()

    qr_buffer = generate_qr_code(str(surge.id))

    return StreamingResponse(
        qr_buffer,
        media_type="image/png"
    )
