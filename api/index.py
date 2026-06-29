"""
Vercel serverless entry-point for Tap2Dine FastAPI backend.
Mangum wraps the ASGI app so Vercel's Lambda-style runtime can call it.
"""
import sys
import os

# Make the backend package importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from main import app  # noqa: E402  (FastAPI app)
from mangum import Mangum  # noqa: E402

# Vercel calls `handler` as the ASGI entrypoint
handler = Mangum(app, lifespan="off")
