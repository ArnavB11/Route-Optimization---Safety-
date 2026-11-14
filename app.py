"""Vercel entry point; the local server uses the same FastAPI application."""
from backend.app.main import app

__all__ = ["app"]
