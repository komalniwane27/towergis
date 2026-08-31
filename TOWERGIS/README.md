# TOWERGIS

Telecom Tower Management & Web GIS Platform.

## Phase 1
Customer, Worker and Admin web portals.

## Local setup

1. Install Python 3.11+.
2. Create a virtual environment:
   `python -m venv .venv`
3. Activate it.
4. Install dependencies:
   `pip install -r backend/requirements.txt`
5. Copy `backend/.env.example` to `backend/.env` and configure PostgreSQL/PostGIS.
6. Run:
   `uvicorn backend.app.main:app --reload`
7. Open:
   `http://127.0.0.1:8000/app/`

## Planned production stack
FastAPI + PostgreSQL/PostGIS + GeoServer + OpenLayers.
