# JWT Token Verification for Supabase Authentication
import os
import jwt
import requests
from fastapi import HTTPException
from typing import Optional
import json
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")

# DEBUG: Print on module load
print(f"🔧 SUPABASE_URL: {SUPABASE_URL}")
print(f"🔧 JWT_SECRET: {bool(SUPABASE_JWT_SECRET)}")
print(f"🔧 ANON_KEY: {bool(SUPABASE_ANON_KEY)}")

# Cache for JWT public keys
_jwks_cache = None


def get_supabase_jwks():
    """Fetch Supabase JWT public keys (JWKS)"""
    global _jwks_cache

    if _jwks_cache:
        return _jwks_cache

    if not SUPABASE_URL:
        raise Exception("SUPABASE_URL not configured")

    try:
        # Construct JWKS URL
        jwks_url = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
        print(f"🔑 Fetching JWKS from: {jwks_url}")

        # Add API key header
        headers = {}
        if SUPABASE_ANON_KEY:
            headers["apikey"] = SUPABASE_ANON_KEY

        response = requests.get(jwks_url, headers=headers, timeout=5)
        response.raise_for_status()

        _jwks_cache = response.json()
        print(f"✅ JWKS fetched successfully")
        return _jwks_cache

    except Exception as e:
        print(f"❌ Failed to fetch JWKS: {e}")
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

    print(f"🔐 Verifying token: {token[:30]}...")

    # First, decode without verification to check the algorithm
    try:
        unverified_header = jwt.get_unverified_header(token)
        algorithm = unverified_header.get("alg")
        print(f"📝 Token algorithm: {algorithm}")

        # For ES256 (new Supabase tokens)
        if algorithm == "ES256":
            print("🆕 Using ES256 verification (new JWT Signing Keys)")

            # Get JWKS
            jwks = get_supabase_jwks()
            if not jwks:
                raise HTTPException(
                    status_code=500, detail="Cannot fetch JWT signing keys")

            # Get the key ID from token header
            kid = unverified_header.get("kid")

            # Find the matching public key
            public_key = None
            for key in jwks.get("keys", []):
                if key.get("kid") == kid:
                    # Convert JWK to PEM format
                    from jwt.algorithms import ECAlgorithm
                    public_key = ECAlgorithm.from_jwk(json.dumps(key))
                    break

            if not public_key:
                raise HTTPException(
                    status_code=401, detail="No matching signing key found")

            # Verify with ES256
            payload = jwt.decode(
                token,
                public_key,
                algorithms=["ES256"],
                audience="authenticated",
                options={"verify_aud": True}
            )

        # For HS256 (legacy tokens)
        elif algorithm == "HS256":
            print("🔄 Using HS256 verification (legacy JWT secret)")

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

        print(f"✅ Token verified for user: {user_id}")
        return user_id

    except jwt.ExpiredSignatureError:
        print("❌ Token expired")
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidAudienceError:
        print("❌ Invalid audience")
        raise HTTPException(status_code=401, detail="Invalid token audience")
    except jwt.InvalidTokenError as e:
        print(f"❌ Invalid token: {str(e)}")
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")
    except Exception as e:
        print(f"❌ Token verification error: {str(e)}")
        raise HTTPException(
            status_code=401, detail=f"Token verification failed: {str(e)}")
