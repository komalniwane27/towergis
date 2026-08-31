CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('customer','worker','admin')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS towers (
    id BIGSERIAL PRIMARY KEY,
    tower_code VARCHAR(50) UNIQUE NOT NULL,
    site_name VARCHAR(200) NOT NULL,
    tower_type VARCHAR(100),
    height_m NUMERIC(8,2),
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    operator_name VARCHAR(100),
    technology VARCHAR(100),
    installation_date DATE,
    geom geometry(Point, 4326),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS towers_geom_gix
ON towers USING GIST (geom);

CREATE TABLE IF NOT EXISTS complaints (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT REFERENCES users(id),
    tower_id BIGINT REFERENCES towers(id),
    category VARCHAR(100) NOT NULL,
    description TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'submitted',
    priority VARCHAR(30) NOT NULL DEFAULT 'normal',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_orders (
    id BIGSERIAL PRIMARY KEY,
    complaint_id BIGINT REFERENCES complaints(id),
    tower_id BIGINT REFERENCES towers(id),
    worker_id BIGINT REFERENCES users(id),
    status VARCHAR(30) NOT NULL DEFAULT 'assigned',
    scheduled_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    notes TEXT
);
