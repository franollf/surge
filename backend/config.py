# TTL (Time To Live) + System Constants
from datetime import timedelta
# timedelta represents the difference in time so it'll give back an amount

# SURGE ID Lifetime
# Lets make it last an hour

SURGE_ID_TTL = timedelta(hours=1)


# QR CODE SETTINGS
QR_IMG_SIZE = 300
QR_IMAGE_FORMAT = "png"

# APP SETTINGS

APP_NAME = "SURGE"
