-- Michigan Solar Optimization Database Schema
-- This file contains the complete database schema for the Michigan Solar Optimization Tool

-- Enable PostGIS extension (skip if already exists)
CREATE EXTENSION IF NOT EXISTS postgis;
-- Enable pgcrypto for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

-- Optimizer models table: each row is a set of tunable inputs
CREATE TABLE IF NOT EXISTS models (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    -- Economic parameters
    discount_rate DOUBLE PRECISION,
    inflation_rate DOUBLE PRECISION,
    electricity_escalation DOUBLE PRECISION,
    crop_escalation DOUBLE PRECISION,
    project_life INTEGER,
    -- Solar parameters (capacity_factor comes from PVWatts)
    land_intensity_acres_per_MW DOUBLE PRECISION,
    degradation_rate DOUBLE PRECISION,
    installed_cost_per_MW DOUBLE PRECISION,
    site_prep_cost_per_acre DOUBLE PRECISION,
    grading_cost_per_acre DOUBLE PRECISION,
    retilling_cost_per_acre DOUBLE PRECISION,
    interconnection_fraction DOUBLE PRECISION,
    bond_cost_per_acre DOUBLE PRECISION,
    vegetation_cost_per_acre DOUBLE PRECISION,
    insurance_cost_per_acre DOUBLE PRECISION,
    oandm_cost_per_kw DOUBLE PRECISION,
    replacement_cost_per_MW DOUBLE PRECISION,
    replacement_year INTEGER,
    decommission_cost_per_kw DOUBLE PRECISION,
    remediation_cost_per_acre DOUBLE PRECISION,
    salvage_value_per_acre DOUBLE PRECISION,
    availability_factor DOUBLE PRECISION,
    curtailment_factor DOUBLE PRECISION,
    export_factor DOUBLE PRECISION,
    -- Lease parameters
    lease_min_rate DOUBLE PRECISION,
    lease_max_rate DOUBLE PRECISION,
    lease_escalation_rate DOUBLE PRECISION,
    developer_retention_fraction DOUBLE PRECISION,
    -- Constraint parameters
    constraints_min_ag_fraction DOUBLE PRECISION,
    constraints_max_prime_solar DOUBLE PRECISION,
    constraints_zoning_max_solar DOUBLE PRECISION,
    constraints_setback_fraction DOUBLE PRECISION,
    constraints_easement_acres DOUBLE PRECISION,
    constraints_wetland_exclusion_acres DOUBLE PRECISION,
    constraints_interconnect_capacity_mw DOUBLE PRECISION,
    -- Farmer parameters
    farmer_pa116_credit_per_acre DOUBLE PRECISION,
    -- Equations metadata (optional editable list)
    equations JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed default model matching current hard-coded values
INSERT INTO models (
    name,
    description,
    discount_rate,
    inflation_rate,
    electricity_escalation,
    crop_escalation,
    project_life,
    land_intensity_acres_per_MW,
    degradation_rate,
    installed_cost_per_MW,
    site_prep_cost_per_acre,
    grading_cost_per_acre,
    retilling_cost_per_acre,
    interconnection_fraction,
    bond_cost_per_acre,
    vegetation_cost_per_acre,
    insurance_cost_per_acre,
    oandm_cost_per_kw,
    replacement_cost_per_MW,
    replacement_year,
    decommission_cost_per_kw,
    remediation_cost_per_acre,
    salvage_value_per_acre,
    availability_factor,
    curtailment_factor,
    export_factor,
    lease_min_rate,
    lease_max_rate,
    lease_escalation_rate,
    developer_retention_fraction,
    constraints_min_ag_fraction,
    constraints_max_prime_solar,
    constraints_zoning_max_solar,
    constraints_setback_fraction,
    constraints_easement_acres,
    constraints_wetland_exclusion_acres,
    constraints_interconnect_capacity_mw,
    farmer_pa116_credit_per_acre,
    equations
)
VALUES (
    'Default',
    'Baseline parameters prior to user-defined overrides',
    0.08,
    0.02,
    0.02,
    0.00,
    27,
    5.5,
    0.005,
    1610000.0,
    36800.0,
    8286.0,
    950.0,
    0.30,
    10000.0,
    225.0,
    100.0,
    11.0,
    100000.0,
    14,
    400.0,
    2580.0,
    12500.0,
    0.98,
    0.95,
    1.0,
    NULL,
    NULL,
    0.0,
    0.12,
    0.51,
    40.0,
    40.0,
    0.10,
    0.0,
    0.0,
        10.0,
        0.0,
        '[
            {"title": "Solar CAPEX per acre", "eq": "CAPEX = (C_install / α) + C_site + C_grade + C_retill + C_bond + f_inter × (C_install / α)"},
            {"title": "Solar energy (year t)", "eq": "E_t = 8760 × CF × 1000 × (1 − d)^t × η_avail × η_curt × η_export"},
            {"title": "Solar revenue (year t)", "eq": "Rev_t = (E_t / α) × P_elec × (1 + g_elec)^t"},
            {"title": "Solar NPV (no lease)", "eq": "NPV_solar = Σ_{t=0…T} (Rev_t − Cost_t) / (1+r)^t"},
            {"title": "ITC benefit (year 2)", "eq": "ITC = CAPEX × itc_rate"},
            {"title": "Lease rate", "eq": "L = 0.88 × NPV_solar / Σ_{t=1…T} 1/(1+r)^t"},
            {"title": "Crop PV per acre", "eq": "PV_crop = Σ_{t=1…T} (yield × price_t − cost) / (1+r)^t"},
            {"title": "Objective (maximize)", "eq": "max z = PV_lease × A_s + Σ_j PV_crop_j × A_cj"},
            {"title": "Coupling constraint", "eq": "A_s + Σ A_cj = crop_land"},
            {"title": "Min agriculture", "eq": "Σ A_cj ≥ 0.51 × total_land"},
            {"title": "Solar cap", "eq": "A_s ≤ min(usable, prime_cap, zoning_cap, interconnect × α)"}
        ]'::jsonb
)
ON CONFLICT (name) DO NOTHING;

-- Users table for simple auth
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed admin user (bcrypt via pgcrypto)
INSERT INTO users (username, password_hash)
VALUES ('joshadmin', crypt('BE487', gen_salt('bf')))
ON CONFLICT (username) DO NOTHING;

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