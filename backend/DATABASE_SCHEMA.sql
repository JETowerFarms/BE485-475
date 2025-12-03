-- Michigan Solar Optimization Database Schema
-- PostgreSQL with PostGIS extension

-- Enable PostGIS extension for spatial data
CREATE EXTENSION IF NOT EXISTS postgis;

-- Table: Solar Suitability Grid Data
-- Stores the 120M point high-resolution solar suitability data
CREATE TABLE solar_suitability (
    id BIGSERIAL PRIMARY KEY,
    location GEOGRAPHY(POINT, 4326) NOT NULL,  -- Lat/Lng point (WGS84)
    lat DECIMAL(10, 7) NOT NULL,
    lng DECIMAL(10, 7) NOT NULL,
    overall_score DECIMAL(5, 2),               -- Overall suitability score
    land_cover_score DECIMAL(5, 2),            -- NLCD 2024 land cover score
    slope_score DECIMAL(5, 2),                 -- LandFire 2020 slope score
    transmission_score DECIMAL(5, 2),          -- Proximity to transmission lines
    population_score DECIMAL(5, 2),            -- GPW 2020 population density score
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create spatial index for fast geographic queries
CREATE INDEX idx_solar_suitability_location ON solar_suitability USING GIST(location);

-- Create composite index for lat/lng lookups
CREATE INDEX idx_solar_suitability_lat_lng ON solar_suitability(lat, lng);

-- Create index for overall score filtering
CREATE INDEX idx_solar_suitability_overall ON solar_suitability(overall_score);

-- Table: Michigan Counties
CREATE TABLE counties (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    fips_code VARCHAR(5) UNIQUE NOT NULL,
    boundary GEOGRAPHY(POLYGON, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_counties_boundary ON counties USING GIST(boundary);

-- Table: Michigan Cities
CREATE TABLE cities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    county_id INTEGER REFERENCES counties(id),
    location GEOGRAPHY(POINT, 4326),
    population INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cities_location ON cities USING GIST(location);
CREATE INDEX idx_cities_county ON cities(county_id);

-- Table: Michigan MCD (Minor Civil Divisions)
CREATE TABLE mcd (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    county_id INTEGER REFERENCES counties(id),
    boundary GEOGRAPHY(MULTIPOLYGON, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_mcd_boundary ON mcd USING GIST(boundary);

-- Table: Transmission Lines
CREATE TABLE transmission_lines (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200),
    voltage INTEGER,                           -- Voltage in kV
    line_type VARCHAR(50),
    geometry GEOGRAPHY(LINESTRING, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transmission_lines_geometry ON transmission_lines USING GIST(geometry);

-- Table: Solar Facilities
CREATE TABLE solar_facilities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200),
    capacity_mw DECIMAL(10, 2),                -- Capacity in megawatts
    location GEOGRAPHY(POINT, 4326),
    status VARCHAR(50),                         -- operational, planned, etc.
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_solar_facilities_location ON solar_facilities USING GIST(location);

-- Table: User Farms (persisted from app)
CREATE TABLE farms (
    id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(100),                      -- User identifier
    name VARCHAR(200) NOT NULL,
    boundary GEOGRAPHY(POLYGON, 4326) NOT NULL,
    area_acres DECIMAL(10, 2),
    centroid GEOGRAPHY(POINT, 4326),
    avg_suitability DECIMAL(5, 2),             -- Average suitability score
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_farms_boundary ON farms USING GIST(boundary);
CREATE INDEX idx_farms_user ON farms(user_id);

-- Table: Farm Analysis Results (cached calculations)
CREATE TABLE farm_analysis (
    id BIGSERIAL PRIMARY KEY,
    farm_id BIGINT REFERENCES farms(id) ON DELETE CASCADE,
    total_points INTEGER,                      -- Number of grid points in farm
    avg_overall DECIMAL(5, 2),
    avg_land_cover DECIMAL(5, 2),
    avg_slope DECIMAL(5, 2),
    avg_transmission DECIMAL(5, 2),
    avg_population DECIMAL(5, 2),
    min_score DECIMAL(5, 2),
    max_score DECIMAL(5, 2),
    suitable_area_acres DECIMAL(10, 2),        -- Area with score > threshold
    analysis_data JSONB,                       -- Detailed analysis results
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_farm_analysis_farm ON farm_analysis(farm_id);

-- Table: Elevation Data (if needed separately)
CREATE TABLE elevation (
    id BIGSERIAL PRIMARY KEY,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    lat DECIMAL(10, 7) NOT NULL,
    lng DECIMAL(10, 7) NOT NULL,
    elevation_m DECIMAL(8, 2),                 -- Elevation in meters
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_elevation_location ON elevation USING GIST(location);
CREATE INDEX idx_elevation_lat_lng ON elevation(lat, lng);

-- View: Solar Suitability Summary Statistics
CREATE OR REPLACE VIEW solar_suitability_stats AS
SELECT 
    COUNT(*) as total_points,
    AVG(overall_score) as avg_overall,
    MIN(overall_score) as min_overall,
    MAX(overall_score) as max_overall,
    STDDEV(overall_score) as stddev_overall,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY overall_score) as q1_overall,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY overall_score) as median_overall,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY overall_score) as q3_overall
FROM solar_suitability;

-- Function: Get solar data for a bounding box
CREATE OR REPLACE FUNCTION get_solar_data_bbox(
    min_lat DECIMAL,
    min_lng DECIMAL,
    max_lat DECIMAL,
    max_lng DECIMAL
)
RETURNS TABLE (
    lat DECIMAL,
    lng DECIMAL,
    overall_score DECIMAL,
    land_cover_score DECIMAL,
    slope_score DECIMAL,
    transmission_score DECIMAL,
    population_score DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.lat,
        s.lng,
        s.overall_score,
        s.land_cover_score,
        s.slope_score,
        s.transmission_score,
        s.population_score
    FROM solar_suitability s
    WHERE s.lat BETWEEN min_lat AND max_lat
      AND s.lng BETWEEN min_lng AND max_lng
    ORDER BY s.lat, s.lng;
END;
$$ LANGUAGE plpgsql;

-- Function: Get nearest solar data point
CREATE OR REPLACE FUNCTION get_nearest_solar_point(
    target_lat DECIMAL,
    target_lng DECIMAL
)
RETURNS TABLE (
    lat DECIMAL,
    lng DECIMAL,
    overall_score DECIMAL,
    land_cover_score DECIMAL,
    slope_score DECIMAL,
    transmission_score DECIMAL,
    population_score DECIMAL,
    distance_m DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.lat,
        s.lng,
        s.overall_score,
        s.land_cover_score,
        s.slope_score,
        s.transmission_score,
        s.population_score,
        ST_Distance(
            s.location,
            ST_MakePoint(target_lng, target_lat)::geography
        ) as distance_m
    FROM solar_suitability s
    ORDER BY s.location <-> ST_MakePoint(target_lng, target_lat)::geography
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function: Calculate farm suitability
CREATE OR REPLACE FUNCTION calculate_farm_suitability(
    farm_boundary GEOGRAPHY
)
RETURNS TABLE (
    total_points BIGINT,
    avg_overall DECIMAL,
    avg_land_cover DECIMAL,
    avg_slope DECIMAL,
    avg_transmission DECIMAL,
    avg_population DECIMAL,
    min_score DECIMAL,
    max_score DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT,
        AVG(s.overall_score),
        AVG(s.land_cover_score),
        AVG(s.slope_score),
        AVG(s.transmission_score),
        AVG(s.population_score),
        MIN(s.overall_score),
        MAX(s.overall_score)
    FROM solar_suitability s
    WHERE ST_Intersects(s.location, farm_boundary);
END;
$$ LANGUAGE plpgsql;

-- Partitioning strategy for large solar_suitability table
-- Partition by latitude ranges (Upper/Lower Peninsula)
CREATE TABLE solar_suitability_upper PARTITION OF solar_suitability
    FOR VALUES FROM (45.0) TO (48.5);

CREATE TABLE solar_suitability_lower PARTITION OF solar_suitability
    FOR VALUES FROM (41.5) TO (45.0);

-- Add comments for documentation
COMMENT ON TABLE solar_suitability IS '120M point high-resolution solar suitability data for Michigan at 0.96 acre resolution';
COMMENT ON TABLE farms IS 'User-created farm boundaries with analysis results';
COMMENT ON TABLE farm_analysis IS 'Cached farm analysis to avoid recalculation';
COMMENT ON FUNCTION get_solar_data_bbox IS 'Retrieve solar data for a rectangular geographic area';
COMMENT ON FUNCTION get_nearest_solar_point IS 'Find the closest solar data point to given coordinates';
COMMENT ON FUNCTION calculate_farm_suitability IS 'Calculate average suitability scores for a farm boundary';
