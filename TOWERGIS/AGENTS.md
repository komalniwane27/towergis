# TOWERGIS Agent Instructions

## Scope

This repository is a small FastAPI backend paired with static HTML/CSS/JavaScript portals. Keep Python changes focused on the backend and preserve the existing frontend serving behavior unless the task explicitly changes it.

## Python Setup and Commands

- Use Python 3.11 or newer.
- Create the environment with `python -m venv .venv` and install dependencies with `pip install -r backend/requirements.txt`.
- Start the development API from the repository root with `uvicorn backend.app.main:app --reload`.
- The current repository has no configured automated test suite. For API changes, at minimum verify the application imports and exercise `/` and `/api/health` while the development server is running.
- Python is not currently available through the workspace terminal; do not assume commands can run until the interpreter is installed or the VS Code interpreter is configured.

## Backend Conventions

- The API entry point is [backend/app/main.py](backend/app/main.py); add routes and FastAPI configuration there only when they belong to the application entry point. Keep reusable domain or persistence logic in separate modules as the backend grows.
- Runtime dependencies belong in [backend/requirements.txt](backend/requirements.txt).
- Read configuration from environment variables. Use [backend/.env.example](backend/.env.example) as the template and never commit real credentials or secrets.
- PostgreSQL/PostGIS is the intended persistence layer. Keep schema changes synchronized with [database/schema.sql](database/schema.sql), and use SQLAlchemy/GeoAlchemy2 rather than embedding database-specific logic in route handlers when practical.
- Preserve the current `/app/` static frontend mount and existing API paths unless a requested change requires a deliberate contract update.

## Documentation

Use [README.md](README.md) for the canonical local setup and planned stack details; update it when setup commands or externally visible behavior change.
