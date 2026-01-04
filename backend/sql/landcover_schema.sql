-- Land-cover source datasets (tables for raw land-cover related layers)
-- Idempotent: safe to run multiple times.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_raster;

-- NLCD 2024 land cover raster (stored as PostGIS raster tiles)
-- Note: loading the raster is done via raster2pgsql in scripts/import-landcover-datasets.ps1
CREATE TABLE IF NOT EXISTS landcover_nlcd_2024_raster (
  rid BIGSERIAL PRIMARY KEY,
  rast raster NOT NULL,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Generic JSON-backed tables for vector land-cover/hydro layers.
-- Import process: load into a staging table via ogr2ogr, then copy into these tables.
CREATE TABLE IF NOT EXISTS landcover_waterbody (
  id BIGSERIAL PRIMARY KEY,
  geom geometry(Geometry, 4326),
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes are defined in landcover_indexes.sql so bulk imports can run faster.

CREATE TABLE IF NOT EXISTS landcover_lakes (
  id BIGSERIAL PRIMARY KEY,
  geom geometry(Geometry, 4326),
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS landcover_river_areas (
  id BIGSERIAL PRIMARY KEY,
  geom geometry(Geometry, 4326),
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS landcover_river_lines (
  id BIGSERIAL PRIMARY KEY,
  geom geometry(Geometry, 4326),
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS landcover_streams_mouth (
  id BIGSERIAL PRIMARY KEY,
  geom geometry(Geometry, 4326),
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS landcover_coastlines (
  id BIGSERIAL PRIMARY KEY,
  geom geometry(Geometry, 4326),
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Road/building/landform datasets (JSON-backed vector layers)
CREATE TABLE IF NOT EXISTS landcover_local_roads (
  id BIGSERIAL PRIMARY KEY,
  geom geometry(Geometry, 4326),
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS landcover_primary_roads (
  id BIGSERIAL PRIMARY KEY,
  geom geometry(Geometry, 4326),
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS landcover_roads_usace_ienc (
  id BIGSERIAL PRIMARY KEY,
  geom geometry(Geometry, 4326),
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS landcover_building_locations_usace_ienc (
  id BIGSERIAL PRIMARY KEY,
  geom geometry(Geometry, 4326),
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS landcover_landforms (
  id BIGSERIAL PRIMARY KEY,
  geom geometry(Geometry, 4326),
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS landcover_base_flood_elevations (
  id BIGSERIAL PRIMARY KEY,
  geom geometry(Geometry, 4326),
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Farm-level landcover reports (generated when a farm is created)
CREATE TABLE IF NOT EXISTS farm_landcover_reports (
  id BIGSERIAL PRIMARY KEY,
  farm_id BIGINT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  water_percent DOUBLE PRECISION,
  is_fully_water BOOLEAN NOT NULL DEFAULT FALSE,
  estimated_site_prep_cost_usd DOUBLE PRECISION,
  report JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Externally-fetched pricing inputs ("live" data) used for site-prep estimates.
CREATE TABLE IF NOT EXISTS pricing_snapshots (
  id BIGSERIAL PRIMARY KEY,
  snapshot_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
