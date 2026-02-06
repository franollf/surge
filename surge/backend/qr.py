##  QR Generation Logic ###

# the qr generation library
import qrcode

# bytes is an in-memory file
from io import BytesIO

from config import QR_IMG_SIZE


# create a function to generate the qr code

def generate_qr_code(surge_id: str):
    url = f"http://localhost:8000/passenger?sid={surge_id}"

    # build the structure of the qr code
    qr = qrcode.QRCode(
        version=1,
        box_size=10,
        border=4,
    )

    # encodes the url
    qr.add_data(url)
    # calculates the layout of the qr
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")

    ## THIS IS WRITING THE IMAGE INTO MEMORY
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    ## resets the point to the start so FastAPI doesn't read it from the end
    buffer.seek(0)

    return buffer
