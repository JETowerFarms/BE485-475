-- Fixed version that handles CRS properly
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
  point_5070 GEOMETRY;
BEGIN
  point_geom := ST_SetSRID(ST_MakePoint(lng, lat), 4326);
  point_5070 := ST_Transform(point_geom, 5070);

  -- Sample landcover (5070)
  SELECT ST_Value(rast, 1, point_5070)
  INTO nlcd_val
  FROM landcover_nlcd_2024_raster
  WHERE ST_Intersects(rast, point_5070);

  -- Sample slope (5070)
  SELECT ST_Value(rast, 1, point_5070)
  INTO slope_val
  FROM slope_raster
  WHERE ST_Intersects(rast, point_5070);

  -- Sample population (4326)
  SELECT ST_Value(rast, 1, point_geom)
  INTO pop_val
  FROM population_raster
  WHERE ST_Intersects(rast, point_geom);

  -- Distance to nearest substation (calculate in meters using geography)
  SELECT ST_Distance(
    ST_Transform(geom, 4326)::geography,
    point_geom::geography
  )
  INTO dist_val
  FROM substations
  ORDER BY ST_Transform(geom, 4326)::geography <-> point_geom::geography
  LIMIT 1;

  RETURN QUERY SELECT nlcd_val, slope_val, pop_val, dist_val;
END;
$$ LANGUAGE plpgsql;