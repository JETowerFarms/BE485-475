-- Michigan Solar Optimization Database Schema
-- This file contains the complete database schema for the Michigan Solar Optimization Tool

-- Enable PostGIS extension (skip if already exists)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Create custom functions for solar suitability scoring (skip if already exist)
CREATE OR REPLACE FUNCTION score_landcover(nlcd_code integer)
RETURNS integer AS $$
BEGIN
  CASE nlcd_code
    WHEN 11 THEN RETURN 100; -- Open water
    WHEN 12 THEN RETURN 100; -- Perennial ice/snow
    WHEN 21 THEN RETURN 90;  -- Developed, open space
    WHEN 22 THEN RETURN 70;  -- Developed, low intensity
    WHEN 23 THEN RETURN 50;  -- Developed, medium intensity
    WHEN 24 THEN RETURN 30;  -- Developed, high intensity
    WHEN 31 THEN RETURN 100; -- Barren land
    WHEN 32 THEN RETURN 100; -- Unconsolidated shore
    WHEN 41 THEN RETURN 80;  -- Deciduous forest
    WHEN 42 THEN RETURN 80;  -- Evergreen forest
    WHEN 43 THEN RETURN 80;  -- Mixed forest
    WHEN 51 THEN RETURN 100; -- Dwarf scrub
    WHEN 52 THEN RETURN 100; -- Shrub/scrub
    WHEN 71 THEN RETURN 100; -- Grassland/herbaceous
    WHEN 72 THEN RETURN 100; -- Sedge/herbaceous
    WHEN 73 THEN RETURN 100; -- Lichens
    WHEN 74 THEN RETURN 100; -- Moss
    WHEN 81 THEN RETURN 100; -- Pasture/hay
    WHEN 82 THEN RETURN 100; -- Cultivated crops
    WHEN 90 THEN RETURN 100; -- Woody wetlands
    WHEN 95 THEN RETURN 100; -- Emergent herbaceous wetlands
    ELSE RETURN 60; -- Default for unknown values
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Skip creating functions that already exist
-- score_slope, score_population, score_transmission_distance already exist

-- Create tables (skip if already exist)
CREATE TABLE IF NOT EXISTS farms (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    boundary GEOGRAPHY(POLYGON, 4326) NOT NULL,
    area_acres DOUBLE PRECISION,
    centroid GEOGRAPHY(POINT, 4326),
    avg_suitability DOUBLE PRECISION,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS county_bboxes (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    bbox GEOMETRY(POLYGON, 4326) NOT NULL,
    bbox_5070 GEOMETRY(POLYGON, 5070) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS substations (
    id SERIAL PRIMARY KEY,
    properties JSONB,
    geom GEOMETRY(POINT, 4326),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes (skip if already exist)
CREATE INDEX IF NOT EXISTS idx_farms_boundary ON farms USING GIST (boundary);
CREATE INDEX IF NOT EXISTS idx_farms_user_id ON farms (user_id);
CREATE INDEX IF NOT EXISTS idx_county_bboxes_bbox ON county_bboxes USING GIST (bbox);
CREATE INDEX IF NOT EXISTS idx_county_bboxes_bbox_5070 ON county_bboxes USING GIST (bbox_5070);
CREATE INDEX IF NOT EXISTS idx_substations_geom ON substations USING GIST (geom);

-- Create raster tables (skip if already exist)
CREATE TABLE IF NOT EXISTS landcover_nlcd_2024_raster (
    rid SERIAL PRIMARY KEY,
    rast RASTER,
    filename TEXT
);

CREATE TABLE IF NOT EXISTS slope_raster (
    rid SERIAL PRIMARY KEY,
    rast RASTER,
    filename TEXT
);

CREATE TABLE IF NOT EXISTS population_raster (
    rid SERIAL PRIMARY KEY,
    rast RASTER,
    filename TEXT
);

-- Create raster indexes (skip if already exist)
CREATE INDEX IF NOT EXISTS idx_landcover_nlcd_2024_raster_rast ON landcover_nlcd_2024_raster USING GIST (ST_ConvexHull(rast));
CREATE INDEX IF NOT EXISTS idx_slope_raster_rast ON slope_raster USING GIST (ST_ConvexHull(rast));
CREATE INDEX IF NOT EXISTS idx_population_raster_rast ON population_raster USING GIST (ST_ConvexHull(rast));

-- Insert sample farm data (skip if already exists)
INSERT INTO farms (user_id, name, boundary) VALUES
('demo', 'Small Solar Farm (150 acres)', ST_GeomFromText('POLYGON((-82.8 42.2, -82.8 42.25, -82.75 42.25, -82.75 42.2, -82.8 42.2))', 4326)),
('demo', 'Medium Solar Farm (300 acres)', ST_GeomFromText('POLYGON((-82.85 42.15, -82.85 42.22, -82.78 42.22, -82.78 42.15, -82.85 42.15))', 4326)),
('demo', 'Large Solar Farm (500 acres)', ST_GeomFromText('POLYGON((-82.9 42.1, -82.9 42.2, -82.75 42.2, -82.75 42.1, -82.9 42.1))', 4326))
ON CONFLICT DO NOTHING;