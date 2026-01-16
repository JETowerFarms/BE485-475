-- Debug version that returns raw sampled values
CREATE OR REPLACE FUNCTION calculate_solar_suitability(
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION
)
RETURNS TABLE(
  nlcd_val INTEGER,
  slope_val NUMERIC,
  pop_val NUMERIC,
  dist_val NUMERIC
) AS $$
DECLARE
  point_geom GEOMETRY;
  v_nlcd INTEGER;
  v_slope NUMERIC;
  v_pop NUMERIC;
  v_dist NUMERIC;
BEGIN
  point_geom := ST_SetSRID(ST_MakePoint(lng, lat), 4326);

  -- Sample landcover
  SELECT ST_Value(rast, ST_Transform(point_geom, 5070))
  INTO v_nlcd
  FROM landcover_nlcd_2024_raster
  WHERE ST_Intersects(rast, ST_Transform(point_geom, 5070));

  -- Sample slope
  SELECT ST_Value(rast, ST_Transform(point_geom, 5070))
  INTO v_slope
  FROM slope_raster
  WHERE ST_Intersects(rast, ST_Transform(point_geom, 5070));

  -- Sample population
  SELECT ST_Value(rast, point_geom)
  INTO v_pop
  FROM population_raster
  WHERE ST_Intersects(rast, point_geom);

  -- Distance to nearest substation
  SELECT ST_Distance(ST_Transform(geom, 5070), ST_Transform(point_geom, 5070))
  INTO v_dist
  FROM substations
  ORDER BY ST_Transform(geom, 5070) <-> ST_Transform(point_geom, 5070)
  LIMIT 1;

  RETURN QUERY SELECT v_nlcd, v_slope, v_pop, v_dist;
END;
$$ LANGUAGE plpgsql;