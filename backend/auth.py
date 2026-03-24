# JWT Token Verification for Supabase Authentication
import os
import jwt
import requests
from fastapi import HTTPException
from typing import Optional
import json
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")

_jwks_cache = None


def get_supabase_jwks():
    """Fetch Supabase JWT public keys (JWKS)"""
    global _jwks_cache

    if _jwks_cache:
        return _jwks_cache

    if not SUPABASE_URL:
        raise Exception("SUPABASE_URL not configured")

    try:
        jwks_url = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"

        headers = {}
        if SUPABASE_ANON_KEY:
            headers["apikey"] = SUPABASE_ANON_KEY

        response = requests.get(jwks_url, headers=headers, timeout=5)
        response.raise_for_status()

        _jwks_cache = response.json()
        return _jwks_cache

    except Exception as e:
        return None


def verify_token(authorization: Optional[str]) -> str:
    """
    Verify Supabase JWT token and return user_id.
    Supports both ES256 (new) and HS256 (legacy) tokens.
    """
    if not authorization:
        raise HTTPException(
            status_code=401, detail="Missing authorization header")

    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401, detail="Invalid authorization format")

    token = authorization.replace("Bearer ", "")

    try:
        unverified_header = jwt.get_unverified_header(token)
        algorithm = unverified_header.get("alg")

        if algorithm == "ES256":
            jwks = get_supabase_jwks()
            if not jwks:
                raise HTTPException(
                    status_code=500, detail="Cannot fetch JWT signing keys")

            kid = unverified_header.get("kid")

            public_key = None
            for key in jwks.get("keys", []):
                if key.get("kid") == kid:
                    from jwt.algorithms import ECAlgorithm
                    public_key = ECAlgorithm.from_jwk(json.dumps(key))
                    break

            if not public_key:
                raise HTTPException(
                    status_code=401, detail="No matching signing key found")

            payload = jwt.decode(
                token,
                public_key,
                algorithms=["ES256"],
                audience="authenticated",
                options={"verify_aud": True}
            )

        elif algorithm == "HS256":
            if not SUPABASE_JWT_SECRET:
                raise HTTPException(
                    status_code=500, detail="JWT secret not configured")

            payload = jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
                options={"verify_aud": True}
            )

        else:
            raise HTTPException(
                status_code=401, detail=f"Unsupported algorithm: {algorithm}")

        user_id = payload.get("sub")

        if not user_id:
            raise HTTPException(
                status_code=401, detail="Invalid token: no user ID")

        return user_id

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidAudienceError:
        raise HTTPException(status_code=401, detail="Invalid token audience")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")
    except Exception as e:
        raise HTTPException(
            status_code=401, detail=f"Token verification failed: {str(e)}")
