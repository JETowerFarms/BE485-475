-- Indexes for landcover tables.
-- Kept separate from landcover_schema.sql so bulk imports can load data first,
-- then build indexes once at the end (much faster).

CREATE INDEX IF NOT EXISTS idx_landcover_waterbody_geom ON landcover_waterbody USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_landcover_lakes_geom ON landcover_lakes USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_landcover_river_areas_geom ON landcover_river_areas USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_landcover_river_lines_geom ON landcover_river_lines USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_landcover_streams_mouth_geom ON landcover_streams_mouth USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_landcover_coastlines_geom ON landcover_coastlines USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_landcover_local_roads_geom ON landcover_local_roads USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_landcover_primary_roads_geom ON landcover_primary_roads USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_landcover_roads_usace_ienc_geom ON landcover_roads_usace_ienc USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_landcover_building_locations_usace_ienc_geom ON landcover_building_locations_usace_ienc USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_landcover_landforms_geom ON landcover_landforms USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_landcover_base_flood_elevations_geom ON landcover_base_flood_elevations USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_farm_landcover_reports_farm_id_created_at
  ON farm_landcover_reports (farm_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pricing_snapshots_key_retrieved_at
  ON pricing_snapshots (snapshot_key, retrieved_at DESC);
