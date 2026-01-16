-- Solar suitability scoring functions based on EGLE methodology
-- 40% landcover, 30% slope, 20% population, 10% transmission distance

-- Function to score landcover (0-100, higher is better)
CREATE OR REPLACE FUNCTION score_landcover(nlcd_code INTEGER)
RETURNS INTEGER AS $$
BEGIN
  -- EGLE solar landcover scoring
  CASE
    WHEN nlcd_code IN (81, 82) THEN RETURN 100;  -- Pasture/Hay, Cultivated Crops
    WHEN nlcd_code IN (71) THEN RETURN 90;      -- Grassland/Herbaceous
    WHEN nlcd_code IN (52, 31) THEN RETURN 80;  -- Shrub/Scrub, Barren Land
    WHEN nlcd_code IN (41, 42, 43) THEN RETURN 60; -- Deciduous/Mixed/Evergreen Forest
    WHEN nlcd_code IN (21, 22, 23, 24) THEN RETURN 40; -- Developed (open space to high intensity)
    WHEN nlcd_code IN (11, 12, 90, 95) THEN RETURN 20; -- Open Water, Perennial Ice/Snow, Woody Wetlands, Emergent Herbaceous Wetlands
    ELSE RETURN 50; -- Unknown/default
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- Function to score slope (0-100, higher is better, lower slope preferred)
CREATE OR REPLACE FUNCTION score_slope(slope_degrees NUMERIC)
RETURNS INTEGER AS $$
BEGIN
  -- Convert degrees to percent approximately (tan(slope_degrees * pi/180) * 100)
  -- But for simplicity, score directly on degrees
  CASE
    WHEN slope_degrees <= 1 THEN RETURN 100;
    WHEN slope_degrees <= 3 THEN RETURN 90;
    WHEN slope_degrees <= 5 THEN RETURN 80;
    WHEN slope_degrees <= 10 THEN RETURN 60;
    WHEN slope_degrees <= 15 THEN RETURN 40;
    WHEN slope_degrees <= 20 THEN RETURN 20;
    ELSE RETURN 10;
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- Function to score population density (0-100, higher is better, lower density preferred)
CREATE OR REPLACE FUNCTION score_population(pop_density NUMERIC)
RETURNS INTEGER AS $$
BEGIN
  -- Population per square km
  CASE
    WHEN pop_density <= 10 THEN RETURN 100;
    WHEN pop_density <= 50 THEN RETURN 90;
    WHEN pop_density <= 100 THEN RETURN 80;
    WHEN pop_density <= 500 THEN RETURN 60;
    WHEN pop_density <= 1000 THEN RETURN 40;
    WHEN pop_density <= 5000 THEN RETURN 20;
    ELSE RETURN 10;
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- Function to score distance to nearest substation (0-100, higher is better, closer preferred)
CREATE OR REPLACE FUNCTION score_transmission_distance(distance_meters NUMERIC)
RETURNS INTEGER AS $$
BEGIN
  -- Distance in meters
  CASE
    WHEN distance_meters <= 1000 THEN RETURN 100;  -- Within 1km
    WHEN distance_meters <= 5000 THEN RETURN 90;   -- Within 5km
    WHEN distance_meters <= 10000 THEN RETURN 80;  -- Within 10km
    WHEN distance_meters <= 20000 THEN RETURN 60;  -- Within 20km
    WHEN distance_meters <= 50000 THEN RETURN 40;  -- Within 50km
    ELSE RETURN 20;  -- Over 50km
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- Main function to calculate overall solar suitability score
CREATE OR REPLACE FUNCTION calculate_solar_suitability(
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION
)
RETURNS TABLE(
  landcover_score INTEGER,
  slope_score INTEGER,
  population_score INTEGER,
  transmission_score INTEGER,
  overall_score NUMERIC
) AS $$
DECLARE
  nlcd_val INTEGER;
  slope_val NUMERIC;
  pop_val NUMERIC;
  dist_val NUMERIC;
  point_geom GEOMETRY;
BEGIN
  -- Create point geometry
  point_geom := ST_SetSRID(ST_MakePoint(lng, lat), 4326);

  -- Sample landcover (NLCD)
  SELECT ST_Value(rast, ST_Transform(point_geom, 5070))
  INTO nlcd_val
  FROM landcover_nlcd_2024_raster
  WHERE ST_Intersects(rast, ST_Transform(point_geom, 5070));

  -- Sample slope
  SELECT ST_Value(rast, ST_Transform(point_geom, 5070))
  INTO slope_val
  FROM slope_raster
  WHERE ST_Intersects(rast, ST_Transform(point_geom, 5070));

  -- Sample population (GPW is in 4326, so no transform needed)
  SELECT ST_Value(rast, point_geom)
  INTO pop_val
  FROM population_raster
  WHERE ST_Intersects(rast, point_geom);

  -- Calculate distance to nearest substation
  SELECT ST_Distance(ST_Transform(geom, 5070), ST_Transform(point_geom, 5070))
  INTO dist_val
  FROM substations
  ORDER BY ST_Transform(geom, 5070) <-> ST_Transform(point_geom, 5070)
  LIMIT 1;

  -- Return scores (handle NULLs by using defaults)
  RETURN QUERY SELECT
    COALESCE(score_landcover(nlcd_val), 50),
    COALESCE(score_slope(slope_val), 50),
    COALESCE(score_population(pop_val), 50),
    COALESCE(score_transmission_distance(dist_val), 50),
    (0.4 * COALESCE(score_landcover(nlcd_val), 50) +
     0.3 * COALESCE(score_slope(slope_val), 50) +
     0.2 * COALESCE(score_population(pop_val), 50) +
     0.1 * COALESCE(score_transmission_distance(dist_val), 50));
END;
$$ LANGUAGE plpgsql;