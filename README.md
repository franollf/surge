
# SURGE

SURGE is a small FastAPI backend (with a simple static frontend) that uses Redis for storage.

## Requirements
- Python 3.10+ (recommended)
- Redis running locally
- VS Code (optional)

## 1) Clone the repo
```bash
git clone https://github.com/franollf/surge.git
cd surge
```

## 2) Start Redis
```bash
redis-server
```

## 3) Create your backend `.env`
Create `backend/.env` and set your Redis connection values.
```bash
# backend/.env
REDIS_HOST=localhost
REDIS_PORT=6379
```

## 4) Install backend dependencies
```bash
python -m venv .venv
source .venv/bin/activate  # (Windows PowerShell: .\.venv\Scripts\Activate.ps1)
pip install -r backend/requirements.txt
```

## 5) Run the backend API
```bash
cd backend
uvicorn main:app --reload
```

## 6) Open the API docs in your browser
```text
http://127.0.0.1:8000/docs
```

## 7) Open the frontend (static pages)
Open the HTML files directly in your browser (or use VS Code “Live Server”).
```text
frontend/landing/landing.html
```

## Quick test (optional)
This hits the backend endpoint that issues a SURGE ID (returns a PNG QR code and sets the SURGE ID in a header).
```bash
curl -i http://127.0.0.1:8000/issue
```

## Notes
- If Redis is not running or `REDIS_HOST` / `REDIS_PORT` are missing, the backend won’t work correctly.
- Don’t commit `backend/.env` if it contains secrets (prefer a `.env.example` with placeholders).
