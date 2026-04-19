-- Michigan Solar Optimization Tool
-- Database schema (PostgreSQL + PostGIS)

CREATE EXTENSION IF NOT EXISTS postgis;

-- Farm persistence (optional, but required by existing API queries)
CREATE TABLE IF NOT EXISTS farms (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  boundary GEOGRAPHY(POLYGON, 4326) NOT NULL,
  area_acres DOUBLE PRECISION,
  centroid GEOGRAPHY(POINT, 4326),
  avg_suitability DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_farms_user_id
  ON farms (user_id);

CREATE TABLE IF NOT EXISTS farm_analysis (
  farm_id BIGINT PRIMARY KEY REFERENCES farms(id) ON DELETE CASCADE,
  total_points INTEGER,
  avg_overall DOUBLE PRECISION,
  avg_land_cover DOUBLE PRECISION,
  avg_slope DOUBLE PRECISION,
  avg_transmission DOUBLE PRECISION,
  avg_population DOUBLE PRECISION,
  min_score DOUBLE PRECISION,
  max_score DOUBLE PRECISION,
  suitable_area_acres DOUBLE PRECISION,
  analysis_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Optional geo tables used by /api/geo endpoints
CREATE TABLE IF NOT EXISTS counties (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  fips_code TEXT,
  boundary GEOGRAPHY(MULTIPOLYGON, 4326)
);

CREATE TABLE IF NOT EXISTS cities (
  id BIGSERIAL PRIMARY KEY,
  county_id BIGINT REFERENCES counties(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  population BIGINT,
  location GEOGRAPHY(POINT, 4326)
);

-- Crop reference data (for Michigan-focused agricultural workflows)
CREATE TABLE IF NOT EXISTS crops (
  id BIGSERIAL PRIMARY KEY,
  crop TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  -- Yield is stored as kg/ha; basis indicates whether values are fresh weight, dry matter, or grain at standard moisture
  -- yield_basis_code: 1=grain_std_moisture, 2=fresh_weight, 3=dry_matter
  yield_basis_code SMALLINT NOT NULL DEFAULT 2,
  yield_moisture_percent DOUBLE PRECISION,
  yield_low_kg_ha DOUBLE PRECISION,
  yield_typical_kg_ha DOUBLE PRECISION,
  yield_high_kg_ha DOUBLE PRECISION,
  -- Seasonal water requirement (approx ETc) in mm across the growing season
  water_low_mm_season DOUBLE PRECISION,
  water_high_mm_season DOUBLE PRECISION,
  -- Simple sunlight proxy (direct sun hours/day)
  sun_hours_min DOUBLE PRECISION,
  sun_hours_optimal DOUBLE PRECISION,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Nutrient requirements keyed by crop
CREATE TABLE IF NOT EXISTS crop_nutrient_requirements (
  crop_id BIGINT PRIMARY KEY REFERENCES crops(id) ON DELETE CASCADE,
  -- Macronutrients in kg/ha as fertilizer application rate ranges (soil-test dependent)
  n_low_kg_ha DOUBLE PRECISION,
  n_high_kg_ha DOUBLE PRECISION,
  p2o5_low_kg_ha DOUBLE PRECISION,
  p2o5_high_kg_ha DOUBLE PRECISION,
  k2o_low_kg_ha DOUBLE PRECISION,
  k2o_high_kg_ha DOUBLE PRECISION,
  other_nutrients JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed: crops common in Michigan (idempotent)
INSERT INTO crops (
  crop,
  name,
  category,
  yield_basis_code,
  yield_moisture_percent,
  yield_low_kg_ha,
  yield_typical_kg_ha,
  yield_high_kg_ha,
  water_low_mm_season,
  water_high_mm_season,
  sun_hours_min,
  sun_hours_optimal,
  notes
)
VALUES
  -- Grains are stored at standard moisture (corn ~15.5%, soy/wheat ~13%).
  ('corn_grain', 'Corn (grain)', 'row_crop', 1, 15.5, 9000, 11400, 13000, 450, 650, 6, 8, NULL),
  ('soybeans', 'Soybeans', 'row_crop', 1, 13.0, 2500, 3000, 3500, 350, 550, 6, 8, NULL),
  ('wheat', 'Wheat', 'grain', 1, 13.0, 5000, 6000, 7000, 300, 450, 6, 8, NULL),
  ('dry_beans', 'Dry beans', 'legume', 2, NULL, 2000, 2500, 3000, 300, 450, 6, 8, NULL),
  ('sugar_beets', 'Sugar beets', 'row_crop', 2, NULL, 50000, 60000, 70000, 550, 750, 6, 8, NULL),
  ('potatoes', 'Potatoes', 'vegetable', 2, NULL, 40000, 45000, 50000, 400, 600, 6, 8, NULL),
  ('tart_cherries', 'Tart cherries', 'fruit', 2, NULL, 10000, 12500, 15000, 300, 500, 6, 8, NULL),
  ('apples', 'Apples', 'fruit', 2, NULL, 30000, 35000, 40000, 300, 500, 6, 8, NULL),
  ('blueberries', 'Blueberries', 'fruit', 2, NULL, 6000, 8000, 10000, 350, 550, 6, 8, 'Often managed for acidic soils'),
  ('grapes', 'Grapes', 'fruit', 2, NULL, 8000, 10000, 12000, 350, 550, 6, 8, NULL),
  ('cucumbers', 'Cucumbers', 'vegetable', 2, NULL, 20000, 25000, 30000, 350, 500, 6, 8, NULL),
  ('tomatoes', 'Tomatoes', 'vegetable', 2, NULL, 40000, 50000, 60000, 400, 600, 6, 8, NULL),
  ('asparagus', 'Asparagus', 'vegetable', 2, NULL, 5000, 6000, 7000, 300, 450, 6, 8, NULL),
  ('carrots', 'Carrots', 'vegetable', 2, NULL, 30000, 35000, 40000, 300, 450, 6, 8, NULL),
  ('onions', 'Onions', 'vegetable', 2, NULL, 30000, 35000, 40000, 300, 450, 6, 8, NULL),
  ('alfalfa_hay', 'Alfalfa / hay', 'forage', 3, 0.0, 6000, 7000, 8000, 600, 800, 6, 8, 'Yield is dry matter (DM)')
ON CONFLICT (crop) DO NOTHING;

-- Seed: nutrient requirement categories (coarse defaults; refine per-rotation/soil test)
INSERT INTO crop_nutrient_requirements (
  crop_id,
  n_low_kg_ha,
  n_high_kg_ha,
  p2o5_low_kg_ha,
  p2o5_high_kg_ha,
  k2o_low_kg_ha,
  k2o_high_kg_ha,
  other_nutrients,
  notes
)
SELECT c.id,
       v.n_low_kg_ha,
       v.n_high_kg_ha,
       v.p2o5_low_kg_ha,
       v.p2o5_high_kg_ha,
       v.k2o_low_kg_ha,
       v.k2o_high_kg_ha,
       v.other_nutrients,
       v.notes
FROM crops c
JOIN (
  VALUES
    -- Values are typical Michigan recommendation ranges in kg/ha as N, P2O5, K2O.
    ('corn_grain', 100, 240, 45, 90, 40, 90, NULL::jsonb, NULL),
    ('soybeans', 0, 0, 50, 60, 45, 75, NULL::jsonb, 'Nitrogen often supplied via fixation; exact rates depend on soil test and yield goal'),
    ('wheat', 35, 100, 30, 65, 20, 35, NULL::jsonb, NULL),
    ('dry_beans', 45, 55, 20, 30, 25, 45, NULL::jsonb, NULL),
    ('sugar_beets', 50, 90, 25, 45, 75, 120, NULL::jsonb, NULL),
    ('potatoes', 100, 200, 30, 70, 100, 200, NULL::jsonb, NULL),
    ('tart_cherries', 30, 50, 20, 60, 50, 150, NULL::jsonb, NULL),
    ('apples', 30, 65, 20, 80, 50, 150, NULL::jsonb, NULL),
    ('blueberries', 25, 75, 40, 110, 50, 150, '{"pH":"acidic_preferred"}'::jsonb, NULL),
    ('grapes', 20, 60, 30, 80, 60, 150, NULL::jsonb, NULL),
    ('cucumbers', 50, 120, 15, 40, 60, 120, NULL::jsonb, NULL),
    ('tomatoes', 100, 200, 50, 100, 100, 200, NULL::jsonb, NULL),
    ('asparagus', 80, 200, 45, 90, 45, 90, NULL::jsonb, NULL),
    ('carrots', 50, 120, 15, 80, 90, 400, NULL::jsonb, NULL),
    ('onions', 50, 100, 135, 170, 335, 400, NULL::jsonb, NULL),
    ('alfalfa_hay', 0, 20, 45, 175, 120, 320, NULL::jsonb, 'Legume N credit often reduces N needs; P/K removal can be high')
) AS v(crop, n_low_kg_ha, n_high_kg_ha, p2o5_low_kg_ha, p2o5_high_kg_ha, k2o_low_kg_ha, k2o_high_kg_ha, other_nutrients, notes)
  ON v.crop = c.crop
ON CONFLICT (crop_id) DO NOTHING;
