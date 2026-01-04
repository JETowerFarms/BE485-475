const pgp = require('pg-promise')();
const dotenv = require('dotenv');

dotenv.config();

// Database connection configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.DB_NAME || 'michigan_solar',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: parseInt(process.env.DB_MAX_CONNECTIONS, 10) || 20,
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT, 10) || 30000,
  connectionTimeoutMillis: 10000,
};

// Create database instance
const db = pgp(dbConfig);

// Test database connection
async function testConnection() {
  try {
    await db.one('SELECT NOW()');
    console.log('✓ Database connection successful');
    return true;
  } catch (error) {
    console.error('✗ Database connection failed:', error.message);
    return false;
  }
}

function getDbConnectionHint() {
  return {
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
  };
}

function isDbConnectionError(error) {
  if (!error) return false;
  if (error.code === 'ECONNREFUSED') return true;
  if (error.code === 'ENOTFOUND') return true;
  if (error.code === 'ETIMEDOUT') return true;

  // Node can wrap multiple failed connection attempts in an AggregateError.
  if (error.name === 'AggregateError' && Array.isArray(error.errors)) {
    return error.errors.some((e) => e && typeof e === 'object' && isDbConnectionError(e));
  }
  return false;
}

// Helper functions for common queries
const queries = {
  // Get solar data point by exact coordinates
  getSolarPoint: async (lat, lng) => {
    return db.oneOrNone(
      `SELECT lat, lng, overall_score, land_cover_score, slope_score, 
              transmission_score, population_score
       FROM solar_suitability
       WHERE lat = $1 AND lng = $2`,
      [lat, lng]
    );
  },

  // Get nearest solar data point
  getNearestSolarPoint: async (lat, lng) => {
    return db.oneOrNone(
      `SELECT * FROM get_nearest_solar_point($1, $2)`,
      [lat, lng]
    );
  },

  // Get solar data within bounding box
  getSolarDataBBox: async (minLat, minLng, maxLat, maxLng, limit = 10000) => {
    return db.any(
      `SELECT lat, lng, overall_score, land_cover_score, slope_score,
              transmission_score, population_score
       FROM solar_suitability
       WHERE lat BETWEEN $1 AND $3
         AND lng BETWEEN $2 AND $4
       ORDER BY lat, lng
       LIMIT $5`,
      [minLat, minLng, maxLat, maxLng, limit]
    );
  },

  // Get solar data within polygon (simplified without PostGIS)
  getSolarDataInPolygon: async (coordinates, limit = 50000) => {
    // Calculate bounding box from polygon coordinates
    const lats = coordinates.map(c => c[1]);
    const lngs = coordinates.map(c => c[0]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    
    // Get all points in bounding box
    return db.any(
      `SELECT lat, lng, overall_score, land_cover_score, slope_score,
              transmission_score, population_score
       FROM solar_suitability
       WHERE lat BETWEEN $1 AND $2
         AND lng BETWEEN $3 AND $4
       LIMIT $5`,
      [minLat, maxLat, minLng, maxLng, limit]
    );
  },

  // Calculate farm suitability
  calculateFarmSuitability: async (polygonWKT) => {
    return db.one(
      `SELECT * FROM calculate_farm_suitability(
         ST_GeomFromText($1, 4326)::geography
       )`,
      [polygonWKT]
    );
  },

  // Save farm
  saveFarm: async (userId, name, boundaryGeoJSON, areaAcres, avgSuitability) => {
    return db.one(
      `INSERT INTO farms (user_id, name, boundary, area_acres, centroid, avg_suitability)
       VALUES ($1, $2, ST_GeomFromGeoJSON($3)::geography, $4, 
               ST_Centroid(ST_GeomFromGeoJSON($3)::geography), $5)
       RETURNING id, name, area_acres, avg_suitability, created_at`,
      [userId, name, JSON.stringify(boundaryGeoJSON), areaAcres, avgSuitability]
    );
  },

  // Get user farms
  getUserFarms: async (userId) => {
    return db.any(
      `SELECT id, name, area_acres, avg_suitability, 
              ST_AsGeoJSON(boundary)::json as boundary,
              created_at, updated_at
       FROM farms
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
  },

  // Get farm by ID
  getFarmById: async (farmId) => {
    return db.oneOrNone(
      `SELECT id, user_id, name, area_acres, avg_suitability,
              ST_AsGeoJSON(boundary)::json as boundary,
              ST_AsGeoJSON(centroid)::json as centroid,
              created_at, updated_at
       FROM farms
       WHERE id = $1`,
      [farmId]
    );
  },

  // Delete farm
  deleteFarm: async (farmId, userId) => {
    return db.result(
      `DELETE FROM farms WHERE id = $1 AND user_id = $2`,
      [farmId, userId]
    );
  },

  // Get farm analysis
  getFarmAnalysis: async (farmId) => {
    return db.oneOrNone(
      `SELECT * FROM farm_analysis WHERE farm_id = $1`,
      [farmId]
    );
  },

  // Save farm analysis
  saveFarmAnalysis: async (farmId, analysisData) => {
    const {
      total_points,
      avg_overall,
      avg_land_cover,
      avg_slope,
      avg_transmission,
      avg_population,
      min_score,
      max_score,
      suitable_area_acres,
      analysis_data,
    } = analysisData;

    return db.one(
      `INSERT INTO farm_analysis 
       (farm_id, total_points, avg_overall, avg_land_cover, avg_slope,
        avg_transmission, avg_population, min_score, max_score,
        suitable_area_acres, analysis_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (farm_id) DO UPDATE SET
         total_points = EXCLUDED.total_points,
         avg_overall = EXCLUDED.avg_overall,
         avg_land_cover = EXCLUDED.avg_land_cover,
         avg_slope = EXCLUDED.avg_slope,
         avg_transmission = EXCLUDED.avg_transmission,
         avg_population = EXCLUDED.avg_population,
         min_score = EXCLUDED.min_score,
         max_score = EXCLUDED.max_score,
         suitable_area_acres = EXCLUDED.suitable_area_acres,
         analysis_data = EXCLUDED.analysis_data,
         created_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        farmId,
        total_points,
        avg_overall,
        avg_land_cover,
        avg_slope,
        avg_transmission,
        avg_population,
        min_score,
        max_score,
        suitable_area_acres,
        JSON.stringify(analysis_data),
      ]
    );
  },
  
  // NLCD value counts within a farm polygon (GeoJSON polygon)
  getNlcdValueCountsForGeoJSON: async (boundaryGeoJSON) => {
    return db.any(
      `WITH rawfarm AS (
         SELECT ST_CollectionExtract(
           ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)),
           3
         ) AS g4326
       ),
       farm AS (
         SELECT g4326, ST_Transform(g4326, 5070) AS g5070
         FROM rawfarm
       ),
       clipped AS (
         SELECT ST_Clip(r.rast, f.g5070, TRUE) AS rast
         FROM landcover_nlcd_2024_raster r
         JOIN farm f ON ST_Intersects(r.rast, f.g5070)
       ),
       vals AS (
         SELECT (vc).value::int AS value, (vc).count::bigint AS count
         FROM clipped
         CROSS JOIN LATERAL ST_ValueCount(rast, 1, TRUE) AS vc
       )
       SELECT value, SUM(count)::bigint AS cells
       FROM vals
       WHERE value IS NOT NULL
       GROUP BY value
       ORDER BY value;`,
      [boundaryGeoJSON]
    );
  },

  // Water/lake/river presence checks against vector layers
  getWaterFeatureFlagsForGeoJSON: async (boundaryGeoJSON) => {
    return db.one(
      `WITH farm AS (
         SELECT ST_CollectionExtract(
           ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)),
           3
         ) AS g
       )
       SELECT
         EXISTS(
           SELECT 1
           FROM landcover_waterbody w, farm f
           WHERE w.geom IS NOT NULL AND ST_Intersects(w.geom, f.g)
           LIMIT 1
         ) AS has_waterbody,
         EXISTS(
           SELECT 1
           FROM landcover_lakes l, farm f
           WHERE l.geom IS NOT NULL AND ST_Intersects(l.geom, f.g)
           LIMIT 1
         ) AS has_lake,
         EXISTS(
           SELECT 1
           FROM landcover_river_areas a, farm f
           WHERE a.geom IS NOT NULL AND ST_Intersects(a.geom, f.g)
           LIMIT 1
         )
         OR EXISTS(
           SELECT 1
           FROM landcover_river_lines rl, farm f
           WHERE rl.geom IS NOT NULL AND ST_Intersects(rl.geom, f.g)
           LIMIT 1
         )
         OR EXISTS(
           SELECT 1
           FROM landcover_streams_mouth sm, farm f
           WHERE sm.geom IS NOT NULL AND ST_Intersects(sm.geom, f.g)
           LIMIT 1
         ) AS has_river;`,
      [boundaryGeoJSON]
    );
  },

  // Small sample of intersecting features (for "note it" reporting)
  getWaterFeatureExamplesForGeoJSON: async (boundaryGeoJSON, limit = 5) => {
    return db.any(
      `WITH farm AS (
         SELECT ST_CollectionExtract(
           ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)),
           3
         ) AS g
       ),
       hits AS (
         (SELECT 'landcover_lakes'::text AS table_name, l.source_file, l.attrs
          FROM landcover_lakes l, farm f
          WHERE l.geom IS NOT NULL AND ST_Intersects(l.geom, f.g)
          ORDER BY l.id
          LIMIT 1)
         UNION ALL
         (SELECT 'landcover_river_areas'::text AS table_name, a.source_file, a.attrs
          FROM landcover_river_areas a, farm f
          WHERE a.geom IS NOT NULL AND ST_Intersects(a.geom, f.g)
          ORDER BY a.id
          LIMIT 1)
         UNION ALL
         (SELECT 'landcover_river_lines'::text AS table_name, rl.source_file, rl.attrs
          FROM landcover_river_lines rl, farm f
          WHERE rl.geom IS NOT NULL AND ST_Intersects(rl.geom, f.g)
          ORDER BY rl.id
          LIMIT 1)
         UNION ALL
         (SELECT 'landcover_streams_mouth'::text AS table_name, sm.source_file, sm.attrs
          FROM landcover_streams_mouth sm, farm f
          WHERE sm.geom IS NOT NULL AND ST_Intersects(sm.geom, f.g)
          ORDER BY sm.id
          LIMIT 1)
         UNION ALL
         (SELECT 'landcover_waterbody'::text AS table_name, w.source_file, w.attrs
          FROM landcover_waterbody w, farm f
          WHERE w.geom IS NOT NULL AND ST_Intersects(w.geom, f.g)
          ORDER BY w.id
          LIMIT 1)
       )
       SELECT table_name, source_file, attrs
       FROM hits
       LIMIT $2;`,
      [boundaryGeoJSON, limit]
    );
  },

  // Percent-of-farm coverage per landcover water table used for indexing.
  // Notes:
  // - Polygon layers use true intersection area.
  // - Line/point layers are buffered (meters) before computing area.
  getWaterFeatureCoveragePercentsForGeoJSON: async (boundaryGeoJSON, bufferMeters = 10) => {
    return db.any(
      `WITH rawfarm AS (
         SELECT ST_CollectionExtract(
           ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)),
           3
         ) AS g4326
       ),
       farm AS (
         SELECT g4326, ST_Transform(g4326, 5070) AS g5070
         FROM rawfarm
       ),
       farm_area AS (
         SELECT NULLIF(ST_Area(g5070), 0) AS area_m2
         FROM farm
       ),
       per_table AS (
         SELECT 'landcover_waterbody'::text AS table_name,
                SUM(ST_Area(ST_Intersection(ST_Transform(w.geom, 5070), f.g5070))) AS covered_m2
         FROM landcover_waterbody w
         CROSS JOIN farm f
         WHERE w.geom IS NOT NULL AND ST_Intersects(w.geom, f.g4326)
         UNION ALL
         SELECT 'landcover_lakes'::text AS table_name,
                SUM(ST_Area(ST_Intersection(ST_Transform(l.geom, 5070), f.g5070))) AS covered_m2
         FROM landcover_lakes l
         CROSS JOIN farm f
         WHERE l.geom IS NOT NULL AND ST_Intersects(l.geom, f.g4326)
         UNION ALL
         SELECT 'landcover_river_areas'::text AS table_name,
                SUM(ST_Area(ST_Intersection(ST_Transform(a.geom, 5070), f.g5070))) AS covered_m2
         FROM landcover_river_areas a
         CROSS JOIN farm f
         WHERE a.geom IS NOT NULL AND ST_Intersects(a.geom, f.g4326)
         UNION ALL
         SELECT 'landcover_river_lines'::text AS table_name,
                SUM(ST_Area(ST_Intersection(ST_Buffer(ST_Transform(rl.geom, 5070), $2), f.g5070))) AS covered_m2
         FROM landcover_river_lines rl
         CROSS JOIN farm f
         WHERE rl.geom IS NOT NULL AND ST_Intersects(rl.geom, f.g4326)
         UNION ALL
         SELECT 'landcover_streams_mouth'::text AS table_name,
                SUM(ST_Area(ST_Intersection(ST_Buffer(ST_Transform(sm.geom, 5070), $2), f.g5070))) AS covered_m2
         FROM landcover_streams_mouth sm
         CROSS JOIN farm f
         WHERE sm.geom IS NOT NULL AND ST_Intersects(sm.geom, f.g4326)
         UNION ALL
         SELECT 'landcover_coastlines'::text AS table_name,
                SUM(ST_Area(ST_Intersection(ST_Buffer(ST_Transform(c.geom, 5070), $2), f.g5070))) AS covered_m2
         FROM landcover_coastlines c
         CROSS JOIN farm f
         WHERE c.geom IS NOT NULL AND ST_Intersects(c.geom, f.g4326)
       )
       SELECT
         p.table_name,
         COALESCE(p.covered_m2, 0) AS covered_m2,
         fa.area_m2 AS farm_area_m2,
         CASE
           WHEN fa.area_m2 IS NULL THEN NULL
           ELSE (COALESCE(p.covered_m2, 0) / fa.area_m2) * 100
         END AS percent
       FROM per_table p
       CROSS JOIN farm_area fa
       ORDER BY p.table_name;`,
      [boundaryGeoJSON, bufferMeters]
    );
  },

  // Percent-of-farm coverage for additional landcover-style layers.
  // Notes:
  // - Polygon geometries use true intersection area.
  // - Line/point geometries are buffered (meters) before computing area.
  getAdditionalLayerCoveragePercentsForGeoJSON: async (boundaryGeoJSON, bufferMeters = 10) => {
    return db.any(
      `WITH rawfarm AS (
         SELECT ST_CollectionExtract(
           ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)),
           3
         ) AS g4326
       ),
       farm AS (
         SELECT g4326, ST_Transform(g4326, 5070) AS g5070
         FROM rawfarm
       ),
       farm_area AS (
         SELECT NULLIF(ST_Area(g5070), 0) AS area_m2
         FROM farm
       ),
       per_table AS (
         SELECT 'landcover_local_roads'::text AS table_name,
                SUM(
                  ST_Area(
                    ST_Intersection(
                      CASE
                        WHEN ST_Dimension(lr.geom) = 2 THEN ST_Transform(lr.geom, 5070)
                        ELSE ST_Buffer(ST_Transform(lr.geom, 5070), $2)
                      END,
                      f.g5070
                    )
                  )
                ) AS covered_m2
         FROM landcover_local_roads lr
         CROSS JOIN farm f
         WHERE lr.geom IS NOT NULL AND ST_Intersects(lr.geom, f.g4326)

         UNION ALL
         SELECT 'landcover_primary_roads'::text AS table_name,
                SUM(
                  ST_Area(
                    ST_Intersection(
                      CASE
                        WHEN ST_Dimension(pr.geom) = 2 THEN ST_Transform(pr.geom, 5070)
                        ELSE ST_Buffer(ST_Transform(pr.geom, 5070), $2)
                      END,
                      f.g5070
                    )
                  )
                ) AS covered_m2
         FROM landcover_primary_roads pr
         CROSS JOIN farm f
         WHERE pr.geom IS NOT NULL AND ST_Intersects(pr.geom, f.g4326)

         UNION ALL
         SELECT 'landcover_roads_usace_ienc'::text AS table_name,
                SUM(
                  ST_Area(
                    ST_Intersection(
                      CASE
                        WHEN ST_Dimension(r.geom) = 2 THEN ST_Transform(r.geom, 5070)
                        ELSE ST_Buffer(ST_Transform(r.geom, 5070), $2)
                      END,
                      f.g5070
                    )
                  )
                ) AS covered_m2
         FROM landcover_roads_usace_ienc r
         CROSS JOIN farm f
         WHERE r.geom IS NOT NULL AND ST_Intersects(r.geom, f.g4326)

         UNION ALL
         SELECT 'landcover_building_locations_usace_ienc'::text AS table_name,
                SUM(
                  ST_Area(
                    ST_Intersection(
                      CASE
                        WHEN ST_Dimension(b.geom) = 2 THEN ST_Transform(b.geom, 5070)
                        ELSE ST_Buffer(ST_Transform(b.geom, 5070), $2)
                      END,
                      f.g5070
                    )
                  )
                ) AS covered_m2
         FROM landcover_building_locations_usace_ienc b
         CROSS JOIN farm f
         WHERE b.geom IS NOT NULL AND ST_Intersects(b.geom, f.g4326)

         UNION ALL
         SELECT 'landcover_landforms'::text AS table_name,
                SUM(
                  ST_Area(
                    ST_Intersection(
                      CASE
                        WHEN ST_Dimension(lf.geom) = 2 THEN ST_Transform(lf.geom, 5070)
                        ELSE ST_Buffer(ST_Transform(lf.geom, 5070), $2)
                      END,
                      f.g5070
                    )
                  )
                ) AS covered_m2
         FROM landcover_landforms lf
         CROSS JOIN farm f
         WHERE lf.geom IS NOT NULL AND ST_Intersects(lf.geom, f.g4326)

         UNION ALL
         SELECT 'landcover_base_flood_elevations'::text AS table_name,
                SUM(
                  ST_Area(
                    ST_Intersection(
                      CASE
                        WHEN ST_Dimension(bfe.geom) = 2 THEN ST_Transform(bfe.geom, 5070)
                        ELSE ST_Buffer(ST_Transform(bfe.geom, 5070), $2)
                      END,
                      f.g5070
                    )
                  )
                ) AS covered_m2
         FROM landcover_base_flood_elevations bfe
         CROSS JOIN farm f
         WHERE bfe.geom IS NOT NULL AND ST_Intersects(bfe.geom, f.g4326)
       )
       SELECT
         p.table_name,
         COALESCE(p.covered_m2, 0) AS covered_m2,
         fa.area_m2 AS farm_area_m2,
         CASE
           WHEN fa.area_m2 IS NULL THEN NULL
           ELSE (COALESCE(p.covered_m2, 0) / fa.area_m2) * 100
         END AS percent
       FROM per_table p
       CROSS JOIN farm_area fa
       ORDER BY p.table_name;`,
      [boundaryGeoJSON, bufferMeters]
    );
  },

  ensureFarmLandcoverReportsTable: async () => {
    return db.none(
      `CREATE TABLE IF NOT EXISTS farm_landcover_reports (
         id BIGSERIAL PRIMARY KEY,
         farm_id BIGINT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
         water_percent DOUBLE PRECISION,
         is_fully_water BOOLEAN NOT NULL DEFAULT FALSE,
         estimated_site_prep_cost_usd DOUBLE PRECISION,
         report JSONB NOT NULL,
         created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
       );
       CREATE INDEX IF NOT EXISTS idx_farm_landcover_reports_farm_id_created_at
         ON farm_landcover_reports (farm_id, created_at DESC);`
    );
  },

  saveFarmLandcoverReport: async (farmId, report) => {
    const waterPercent = report?.nlcd?.waterPercent ?? null;
    const isFullyWater = report?.water?.isFullyWater ?? false;
    const estimatedCostUsd = report?.sitePrepCost?.estimatedTotalUsd ?? null;

    await queries.ensureFarmLandcoverReportsTable();
    return db.one(
      `INSERT INTO farm_landcover_reports
         (farm_id, water_percent, is_fully_water, estimated_site_prep_cost_usd, report)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, farm_id, created_at;`,
      [farmId, waterPercent, isFullyWater, estimatedCostUsd, report]
    );
  },

  getLatestFarmLandcoverReport: async (farmId) => {
    await queries.ensureFarmLandcoverReportsTable();
    return db.oneOrNone(
      `SELECT id, farm_id, report, created_at
       FROM farm_landcover_reports
       WHERE farm_id = $1
       ORDER BY created_at DESC
       LIMIT 1;`,
      [farmId]
    );
  },

  ensurePricingSnapshotsTable: async () => {
    return db.none(
      `CREATE TABLE IF NOT EXISTS pricing_snapshots (
         id BIGSERIAL PRIMARY KEY,
         snapshot_key TEXT NOT NULL,
         payload JSONB NOT NULL,
         retrieved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
       );
       CREATE INDEX IF NOT EXISTS idx_pricing_snapshots_key_retrieved_at
         ON pricing_snapshots (snapshot_key, retrieved_at DESC);`
    );
  },

  getLatestPricingSnapshot: async (snapshotKey) => {
    await queries.ensurePricingSnapshotsTable();
    return db.oneOrNone(
      `SELECT id, snapshot_key, payload, retrieved_at
       FROM pricing_snapshots
       WHERE snapshot_key = $1
       ORDER BY retrieved_at DESC
       LIMIT 1;`,
      [snapshotKey]
    );
  },

  savePricingSnapshot: async (snapshotKey, payload) => {
    await queries.ensurePricingSnapshotsTable();
    return db.one(
      `INSERT INTO pricing_snapshots (snapshot_key, payload)
       VALUES ($1, $2)
       RETURNING id, snapshot_key, retrieved_at;`,
      [snapshotKey, payload]
    );
  },

  // Get statistics
  getStatistics: async () => {
    return db.one(`SELECT * FROM solar_suitability_stats`);
  },

  // Get counties
  getCounties: async () => {
    return db.any(
      `SELECT id, name, fips_code, ST_AsGeoJSON(boundary)::json as boundary
       FROM counties
       ORDER BY name`
    );
  },

  // Get cities by county
  getCitiesByCounty: async (countyId) => {
    return db.any(
      `SELECT id, name, population, ST_AsGeoJSON(location)::json as location
       FROM cities
       WHERE county_id = $1
       ORDER BY name`,
      [countyId]
    );
  },
};

module.exports = {
  db,
  queries,
  testConnection,
  getDbConnectionHint,
  isDbConnectionError,
};
