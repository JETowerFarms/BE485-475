const pgp = require('pg-promise')();
const dotenv = require('dotenv');
const booleanPointInPolygon = require('@turf/boolean-point-in-polygon').default;
const { point: turfPoint, polygon: turfPolygon } = require('@turf/helpers');

dotenv.config();

// Database connection configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: (() => {
    const port = process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432;
    if (process.env.DB_PORT && isNaN(port)) {
      throw new Error('Invalid DB_PORT: must be a valid integer');
    }
    return port;
  })(),
  database: process.env.DB_NAME || 'michigan_solar',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: (() => {
    const max = process.env.DB_MAX_CONNECTIONS ? parseInt(process.env.DB_MAX_CONNECTIONS, 10) : 20;
    if (process.env.DB_MAX_CONNECTIONS && isNaN(max)) {
      throw new Error('Invalid DB_MAX_CONNECTIONS: must be a valid integer');
    }
    return max;
  })(),
  ssl: process.env.PGSSLMODE && process.env.PGSSLMODE !== 'disable'
    ? { rejectUnauthorized: false }
    : false,
  idleTimeoutMillis: (() => {
    const timeout = process.env.DB_IDLE_TIMEOUT ? parseInt(process.env.DB_IDLE_TIMEOUT, 10) : 30000;
    if (process.env.DB_IDLE_TIMEOUT && isNaN(timeout)) {
      throw new Error('Invalid DB_IDLE_TIMEOUT: must be a valid integer');
    }
    return timeout;
  })(),
  connectionTimeoutMillis: (() => {
    const timeout = process.env.DB_CONNECTION_TIMEOUT ? parseInt(process.env.DB_CONNECTION_TIMEOUT, 10) : 60000;
    if (process.env.DB_CONNECTION_TIMEOUT && isNaN(timeout)) {
      throw new Error('Invalid DB_CONNECTION_TIMEOUT: must be a valid integer');
    }
    return timeout;
  })(),
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

// Helper function to calculate polygon area in acres
function calculatePolygonArea(coordinates) {
  if (!coordinates || coordinates.length < 3) {
    return { acres: 0, sqMiles: 0 };
  }

  let coords = [...coordinates];
  if (coords.length > 1) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) {
      coords = coords.slice(0, -1);
    }
  }

  const avgLat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
  const latRad = avgLat * Math.PI / 180;

  const metersPerDegreeLat = 111132.92 - 559.82 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
  const metersPerDegreeLng = 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad);

  let area = 0;
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = coords[i][0] * metersPerDegreeLng;
    const y1 = coords[i][1] * metersPerDegreeLat;
    const x2 = coords[j][0] * metersPerDegreeLng;
    const y2 = coords[j][1] * metersPerDegreeLat;
    area += x1 * y2 - x2 * y1;
  }
  area = Math.abs(area) / 2;

  const acres = area / 4046.8564224;
  const sqMiles = area / 2589988.110336;

  return { acres, sqMiles };
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

  // Calculate farm suitability
  calculateFarmSuitability: async (polygonWKT) => {
    if (!polygonWKT || typeof polygonWKT !== 'string') {
      throw new Error('Invalid polygonWKT: must be a non-empty string');
    }
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
      `WITH b AS (
        SELECT ST_GeomFromGeoJSON($3)::geography AS boundary
      )
      INSERT INTO farms (user_id, name, boundary, area_acres, centroid, avg_suitability)
      SELECT
        $1, $2, b.boundary, $4,
        ST_Centroid(b.boundary),
        $5
      FROM b
      RETURNING id, name, area_acres, avg_suitability, created_at`,
      [userId, name, boundaryGeoJSON, areaAcres, avgSuitability]
    );
  },

  updateFarmAvgSuitability: async (farmId, avgSuitability) => {
    return db.oneOrNone(
      `UPDATE farms
       SET avg_suitability = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [farmId, avgSuitability]
    );
  },

  updateFarmName: async (farmId, userId, name) => {
    return db.oneOrNone(
      `UPDATE farms
       SET name = $3, updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id, name, area_acres, avg_suitability, created_at, updated_at,
                 ST_AsGeoJSON(boundary)::json as boundary`,
      [farmId, userId, name]
    );
  },

  getUserFarms: async (userId) => {
    return db.any(
      `SELECT 
        id, 
        name, 
        area_acres, 
        avg_suitability, 
        created_at, 
        updated_at,
        ST_AsGeoJSON(boundary)::json as boundary
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

  // Get elevation data within polygon (for heat map generation)
  getElevationDataInPolygon: async (coordinates, limit = null) => {
    // Calculate area in acres and determine dynamic limit (0.5 points per acre for better density)
    const area = calculatePolygonArea(coordinates);
    const dynamicLimit = limit || Math.max(1, Math.round(area.acres * 0.5));

    // Calculate bounding box from polygon coordinates
    const lats = coordinates.map(c => c[1]);
    const lngs = coordinates.map(c => c[0]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    // Generate a grid of points within the polygon bounds
    const points = [];
    const latStep = (maxLat - minLat) / Math.sqrt(dynamicLimit);
    const lngStep = (maxLng - minLng) / Math.sqrt(dynamicLimit);
    
    for (let lat = minLat; lat <= maxLat; lat += latStep) {
      for (let lng = minLng; lng <= maxLng; lng += lngStep) {
        // Check if point is inside polygon using point-in-polygon test
        const point = turfPoint([lng, lat]);
        const poly = turfPolygon([coordinates]);
        if (booleanPointInPolygon(point, poly)) {
          points.push({
            lat: parseFloat(lat.toFixed(6)),
            lng: parseFloat(lng.toFixed(6))
          });
        }
        if (points.length >= dynamicLimit) break;
      }
      if (points.length >= dynamicLimit) break;
    }
    
    // If no points found inside polygon, expand bounds and try again
    if (points.length === 0) {
      const expandFactor = 1.5;
      const centerLat = (minLat + maxLat) / 2;
      const centerLng = (minLng + maxLng) / 2;
      const expandedMinLat = centerLat - (centerLat - minLat) * expandFactor;
      const expandedMaxLat = centerLat + (maxLat - centerLat) * expandFactor;
      const expandedMinLng = centerLng - (centerLng - minLng) * expandFactor;
      const expandedMaxLng = centerLng + (maxLng - centerLng) * expandFactor;
      
      const expandedLatStep = (expandedMaxLat - expandedMinLat) / Math.sqrt(dynamicLimit);
      const expandedLngStep = (expandedMaxLng - expandedMinLng) / Math.sqrt(dynamicLimit);
      
      for (let lat = expandedMinLat; lat <= expandedMaxLat; lat += expandedLatStep) {
        for (let lng = expandedMinLng; lng <= expandedMaxLng; lng += expandedLngStep) {
          const point = turfPoint([lng, lat]);
          const poly = turfPolygon([coordinates]);
          if (booleanPointInPolygon(point, poly)) {
            points.push({
              lat: parseFloat(lat.toFixed(6)),
              lng: parseFloat(lng.toFixed(6))
            });
          }
          if (points.length >= Math.max(5, dynamicLimit / 10)) break; // At least 5 points or 10% of limit
        }
        if (points.length >= Math.max(5, dynamicLimit / 10)) break;
      }
    }
    
    // Query real elevation data from raster
    const geojson = JSON.stringify({type: 'Polygon', coordinates: [coordinates]});
    const latsArray = points.map(p => p.lat);
    const lngsArray = points.map(p => p.lng);
    
    if (latsArray.length !== lngsArray.length) {
      throw new Error('Array length mismatch: latsArray and lngsArray must have equal lengths');
    }
    
    const results = await db.any(`
      WITH poly AS (
        SELECT ST_Transform(ST_GeomFromGeoJSON($3), 5070) AS g5070
      ),
      tiles_elev AS (
        SELECT er.rast
        FROM elevation_raster er, poly p
        WHERE er.rast && p.g5070 AND ST_Intersects(er.rast, p.g5070)
      ),
      tiles_slope AS (
        SELECT sr.rast
        FROM slope_raster sr, poly p
        WHERE sr.rast && p.g5070 AND ST_Intersects(sr.rast, p.g5070)
      ),
      pts AS (
        SELECT
          p.lat, p.lng, p.ord,
          ST_Transform(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326), 5070) AS pt5070
        FROM unnest($1::float[], $2::float[]) WITH ORDINALITY AS p(lat, lng, ord)
      )
      SELECT
        pts.lat,
        pts.lng,
        erq.elevation AS elevation,
        srq.slope AS slope
      FROM pts
      JOIN poly ON ST_Covers(poly.g5070, pts.pt5070)
      LEFT JOIN LATERAL (
        SELECT ST_Value(te.rast, pts.pt5070) AS elevation
        FROM tiles_elev te
        WHERE ST_Intersects(te.rast, pts.pt5070)
        LIMIT 1
      ) erq ON TRUE
      LEFT JOIN LATERAL (
        SELECT ST_Value(ts.rast, pts.pt5070) AS slope
        FROM tiles_slope ts
        WHERE ST_Intersects(ts.rast, pts.pt5070)
        LIMIT 1
      ) srq ON TRUE
      ORDER BY pts.ord
    `, [latsArray, lngsArray, geojson]);
    
    // Map results back to points with elevation and slope
    return results.map(row => ({
      lat: row.lat,
      lng: row.lng,
      elevation: row.elevation,
      slope: row.slope
    }));
  },

  // Get solar suitability data within polygon (for heat map generation)
  getSolarDataInPolygon: async (coordinates, limit = null) => {
    // Calculate area in acres and determine dynamic limit (0.5 points per acre for better density)
    const area = calculatePolygonArea(coordinates);
    const dynamicLimit = limit || Math.max(1, Math.round(area.acres * 0.5));
    // Calculate bounding box from polygon coordinates
    const lats = coordinates.map(c => c[1]);
    const lngs = coordinates.map(c => c[0]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    
    // Generate a grid of points within the polygon bounds
    const points = [];
    const latStep = (maxLat - minLat) / Math.sqrt(dynamicLimit);
    const lngStep = (maxLng - minLng) / Math.sqrt(dynamicLimit);
    
    for (let lat = minLat; lat <= maxLat; lat += latStep) {
      for (let lng = minLng; lng <= maxLng; lng += lngStep) {
        // Check if point is inside polygon using point-in-polygon test
        const point = turfPoint([lng, lat]);
        const poly = turfPolygon([coordinates]);
        if (booleanPointInPolygon(point, poly)) {
          points.push({
            lat: parseFloat(lat.toFixed(6)),
            lng: parseFloat(lng.toFixed(6))
          });
        }
        if (points.length >= dynamicLimit) break;
      }
      if (points.length >= dynamicLimit) break;
    }
    
    // If no points found inside polygon, expand bounds and try again
    if (points.length === 0) {
      const expandFactor = 1.5;
      const centerLat = (minLat + maxLat) / 2;
      const centerLng = (minLng + maxLng) / 2;
      const expandedMinLat = centerLat - (centerLat - minLat) * expandFactor;
      const expandedMaxLat = centerLat + (maxLat - centerLat) * expandFactor;
      const expandedMinLng = centerLng - (centerLng - minLng) * expandFactor;
      const expandedMaxLng = centerLng + (maxLng - centerLng) * expandFactor;
      
      const expandedLatStep = (expandedMaxLat - expandedMinLat) / Math.sqrt(dynamicLimit);
      const expandedLngStep = (expandedMaxLng - expandedMinLng) / Math.sqrt(dynamicLimit);
      
      for (let lat = expandedMinLat; lat <= expandedMaxLat; lat += expandedLatStep) {
        for (let lng = expandedMinLng; lng <= expandedMaxLng; lng += expandedLngStep) {
          const point = turfPoint([lng, lat]);
          const poly = turfPolygon([coordinates]);
          if (booleanPointInPolygon(point, poly)) {
            points.push({
              lat: parseFloat(lat.toFixed(6)),
              lng: parseFloat(lng.toFixed(6))
            });
          }
          if (points.length >= Math.max(5, dynamicLimit / 10)) break; // At least 5 points or 10% of limit
        }
        if (points.length >= Math.max(5, dynamicLimit / 10)) break;
      }
    }
    
    // Calculate solar suitability for each point using raster data
    const latsArray = points.map(p => p.lat);
    const lngsArray = points.map(p => p.lng);
    
    if (latsArray.length !== lngsArray.length) {
      throw new Error('Array length mismatch: latsArray and lngsArray must have equal lengths');
    }
    
    const results = await db.any(`
      SELECT
        p.lat,
        p.lng,
        css.overall_score as overall,
        css.landcover_score as land_cover,
        css.slope_score as slope,
        css.transmission_score as transmission,
        css.population_score as population,
        css.overall_score as solar_suitability
      FROM unnest($1::float[], $2::float[]) WITH ORDINALITY AS p(lat, lng, ord)
      CROSS JOIN LATERAL calculate_solar_suitability(p.lat, p.lng) css
      ORDER BY p.ord
    `, [latsArray, lngsArray]);
    
    // Map results back to points with full solar data
    return results.map(row => ({
      lat: row.lat,
      lng: row.lng,
      overall: row.overall,
      land_cover: row.land_cover,
      slope: row.slope,
      transmission: row.transmission,
      population: row.population,
      solarSuitability: row.solar_suitability
    }));
  },

  // Get farm analysis
  getFarmAnalysis: async (farmId) => {
    return db.oneOrNone(
      `SELECT * FROM farm_analysis WHERE farm_id = $1`,
      [farmId]
    );
  },

  // Get farm analysis statuses (lightweight — no analysis_data blob) for a list of ids.
  // Returns only rows that EXIST in farm_analysis; callers should treat missing ids as not-ready.
  getFarmAnalysisStatuses: async (farmIds) => {
    if (!Array.isArray(farmIds) || farmIds.length === 0) return [];
    return db.any(
      `SELECT farm_id FROM farm_analysis WHERE farm_id = ANY($1::int[])`,
      [farmIds]
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
    if (typeof boundaryGeoJSON === 'string') {
      throw new Error('boundaryGeoJSON must be an object, not a pre-stringified JSON string');
    }
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
         JOIN farm f
           ON (r.rast && f.g5070) AND ST_Intersects(r.rast, f.g5070)
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
      [JSON.stringify(boundaryGeoJSON)]
    );
  },

  // Water/lake/river presence checks against vector layers
  getWaterFeatureFlagsForGeoJSON: async (boundaryGeoJSON) => {
    if (typeof boundaryGeoJSON === 'string') {
      throw new Error('boundaryGeoJSON must be an object, not a pre-stringified JSON string');
    }
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
           WHERE w.geom IS NOT NULL AND w.geom && f.g AND ST_Intersects(w.geom, f.g)
           LIMIT 1
         ) AS has_waterbody,
         EXISTS(
           SELECT 1
           FROM landcover_lakes l, farm f
           WHERE l.geom IS NOT NULL AND l.geom && f.g AND ST_Intersects(l.geom, f.g)
           LIMIT 1
         ) AS has_lake,
         EXISTS(
           SELECT 1
           FROM landcover_river_areas a, farm f
           WHERE a.geom IS NOT NULL AND a.geom && f.g AND ST_Intersects(a.geom, f.g)
           LIMIT 1
         )
         OR EXISTS(
           SELECT 1
           FROM landcover_river_lines rl, farm f
           WHERE rl.geom IS NOT NULL AND rl.geom && f.g AND ST_Intersects(rl.geom, f.g)
           LIMIT 1
         )
         OR EXISTS(
           SELECT 1
           FROM landcover_streams_mouth sm, farm f
           WHERE sm.geom IS NOT NULL AND sm.geom && f.g AND ST_Intersects(sm.geom, f.g)
           LIMIT 1
         ) AS has_river;`,
      [JSON.stringify(boundaryGeoJSON)]
    );
  },

  // Small sample of intersecting features (for "note it" reporting)
  getWaterFeatureExamplesForGeoJSON: async (boundaryGeoJSON, limit = 5) => {
    if (typeof boundaryGeoJSON === 'string') {
      throw new Error('boundaryGeoJSON must be an object, not a pre-stringified JSON string');
    }
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
         WHERE l.geom IS NOT NULL AND l.geom && f.g AND ST_Intersects(l.geom, f.g)
          ORDER BY l.id
          LIMIT 1)
         UNION ALL
         (SELECT 'landcover_river_areas'::text AS table_name, a.source_file, a.attrs
          FROM landcover_river_areas a, farm f
         WHERE a.geom IS NOT NULL AND a.geom && f.g AND ST_Intersects(a.geom, f.g)
          ORDER BY a.id
          LIMIT 1)
         UNION ALL
         (SELECT 'landcover_river_lines'::text AS table_name, rl.source_file, rl.attrs
          FROM landcover_river_lines rl, farm f
         WHERE rl.geom IS NOT NULL AND rl.geom && f.g AND ST_Intersects(rl.geom, f.g)
          ORDER BY rl.id
          LIMIT 1)
         UNION ALL
         (SELECT 'landcover_streams_mouth'::text AS table_name, sm.source_file, sm.attrs
          FROM landcover_streams_mouth sm, farm f
         WHERE sm.geom IS NOT NULL AND sm.geom && f.g AND ST_Intersects(sm.geom, f.g)
          ORDER BY sm.id
          LIMIT 1)
         UNION ALL
         (SELECT 'landcover_waterbody'::text AS table_name, w.source_file, w.attrs
          FROM landcover_waterbody w, farm f
         WHERE w.geom IS NOT NULL AND w.geom && f.g AND ST_Intersects(w.geom, f.g)
          ORDER BY w.id
          LIMIT 1)
       )
       SELECT table_name, source_file, attrs
       FROM hits
       LIMIT $2;`,
      [JSON.stringify(boundaryGeoJSON), limit]
    );
  },
  // Additional landcover layer presence checks
  getAdditionalLayerFlagsForGeoJSON: async (boundaryGeoJSON) => {
    if (typeof boundaryGeoJSON === 'string') {
      throw new Error('boundaryGeoJSON must be an object, not a pre-stringified JSON string');
    }
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
           FROM landcover_local_roads lr, farm f
           WHERE lr.geom IS NOT NULL AND lr.geom && f.g AND ST_Intersects(lr.geom, f.g)
           LIMIT 1
         ) AS has_local_roads,
         EXISTS(
           SELECT 1
           FROM landcover_primary_roads pr, farm f
           WHERE pr.geom IS NOT NULL AND pr.geom && f.g AND ST_Intersects(pr.geom, f.g)
           LIMIT 1
         ) AS has_primary_roads,
         EXISTS(
           SELECT 1
           FROM landcover_roads_usace_ienc r, farm f
           WHERE r.geom IS NOT NULL AND r.geom && f.g AND ST_Intersects(r.geom, f.g)
           LIMIT 1
         ) AS has_usace_roads,
         EXISTS(
           SELECT 1
           FROM landcover_building_locations_usace_ienc b, farm f
           WHERE b.geom IS NOT NULL AND b.geom && f.g AND ST_Intersects(b.geom, f.g)
           LIMIT 1
         ) AS has_buildings,
         EXISTS(
           SELECT 1
           FROM landcover_landforms lf, farm f
           WHERE lf.geom IS NOT NULL AND lf.geom && f.g AND ST_Intersects(lf.geom, f.g)
           LIMIT 1
         ) AS has_landforms,
         EXISTS(
           SELECT 1
           FROM landcover_base_flood_elevations bfe, farm f
           WHERE bfe.geom IS NOT NULL AND bfe.geom && f.g AND ST_Intersects(bfe.geom, f.g)
           LIMIT 1
         ) AS has_flood_elevations,
         EXISTS(
           SELECT 1
           FROM landcover_coastlines c, farm f
           WHERE c.geom IS NOT NULL AND c.geom && f.g AND ST_Intersects(c.geom, f.g)
           LIMIT 1
         ) AS has_coastlines;`,
      [JSON.stringify(boundaryGeoJSON)]
    );
  },

  // Small sample of intersecting additional layer features
  getAdditionalLayerExamplesForGeoJSON: async (boundaryGeoJSON, limit = 5) => {
    if (typeof boundaryGeoJSON === 'string') {
      throw new Error('boundaryGeoJSON must be an object, not a pre-stringified JSON string');
    }
    return db.any(
      `WITH farm AS (
         SELECT ST_CollectionExtract(
           ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)),
           3
         ) AS g
       ),
       hits AS (
        (SELECT 'landcover_local_roads'::text AS table_name, lr.source_file, lr.attrs
         FROM landcover_local_roads lr, farm f
         WHERE lr.geom IS NOT NULL AND lr.geom && f.g AND ST_Intersects(lr.geom, f.g)
          ORDER BY lr.id
          LIMIT 1)
         UNION ALL
         (SELECT 'landcover_primary_roads'::text AS table_name, pr.source_file, pr.attrs
          FROM landcover_primary_roads pr, farm f
         WHERE pr.geom IS NOT NULL AND pr.geom && f.g AND ST_Intersects(pr.geom, f.g)
          ORDER BY pr.id
          LIMIT 1)
         UNION ALL
         (SELECT 'landcover_roads_usace_ienc'::text AS table_name, r.source_file, r.attrs
          FROM landcover_roads_usace_ienc r, farm f
         WHERE r.geom IS NOT NULL AND r.geom && f.g AND ST_Intersects(r.geom, f.g)
          ORDER BY r.id
          LIMIT 1)
         UNION ALL
         (SELECT 'landcover_building_locations_usace_ienc'::text AS table_name, b.source_file, b.attrs
          FROM landcover_building_locations_usace_ienc b, farm f
         WHERE b.geom IS NOT NULL AND b.geom && f.g AND ST_Intersects(b.geom, f.g)
          ORDER BY b.id
          LIMIT 1)
         UNION ALL
         (SELECT 'landcover_landforms'::text AS table_name, lf.source_file, lf.attrs
          FROM landcover_landforms lf, farm f
         WHERE lf.geom IS NOT NULL AND lf.geom && f.g AND ST_Intersects(lf.geom, f.g)
          ORDER BY lf.id
          LIMIT 1)
         UNION ALL
         (SELECT 'landcover_base_flood_elevations'::text AS table_name, bfe.source_file, bfe.attrs
          FROM landcover_base_flood_elevations bfe, farm f
         WHERE bfe.geom IS NOT NULL AND bfe.geom && f.g AND ST_Intersects(bfe.geom, f.g)
          ORDER BY bfe.id
          LIMIT 1)
         UNION ALL
         (SELECT 'landcover_coastlines'::text AS table_name, c.source_file, c.attrs
          FROM landcover_coastlines c, farm f
         WHERE c.geom IS NOT NULL AND c.geom && f.g AND ST_Intersects(c.geom, f.g)
          ORDER BY c.id
          LIMIT 1)
       )
       SELECT table_name, source_file, attrs
       FROM hits
       LIMIT $2;`,
      [JSON.stringify(boundaryGeoJSON), limit]
    );
  },
  // Percent-of-farm coverage per landcover water table used for indexing.
  // Notes:
  // - Polygon layers use true intersection area.
  // - Line/point layers are buffered (meters) before computing area.
  getWaterFeatureCoveragePercentsForGeoJSON: async (boundaryGeoJSON, bufferMeters = 10) => {
    if (typeof boundaryGeoJSON === 'string') {
      throw new Error('boundaryGeoJSON must be an object, not a pre-stringified JSON string');
    }
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
          FROM landcover_waterbody w, farm f
          WHERE w.geom IS NOT NULL AND w.geom && f.g4326 AND ST_Intersects(w.geom, f.g4326)
         UNION ALL
         SELECT 'landcover_lakes'::text AS table_name,
                SUM(ST_Area(ST_Intersection(ST_Transform(l.geom, 5070), f.g5070))) AS covered_m2
          FROM landcover_lakes l, farm f
          WHERE l.geom IS NOT NULL AND l.geom && f.g4326 AND ST_Intersects(l.geom, f.g4326)
         UNION ALL
         SELECT 'landcover_river_areas'::text AS table_name,
                SUM(ST_Area(ST_Intersection(ST_Transform(a.geom, 5070), f.g5070))) AS covered_m2
          FROM landcover_river_areas a, farm f
          WHERE a.geom IS NOT NULL AND a.geom && f.g4326 AND ST_Intersects(a.geom, f.g4326)
         UNION ALL
         SELECT 'landcover_river_lines'::text AS table_name,
                SUM(ST_Area(ST_Intersection(ST_Buffer(ST_Transform(rl.geom, 5070), $2), f.g5070))) AS covered_m2
          FROM landcover_river_lines rl, farm f
          WHERE rl.geom IS NOT NULL AND rl.geom && f.g4326 AND ST_Intersects(rl.geom, f.g4326)
         UNION ALL
         SELECT 'landcover_streams_mouth'::text AS table_name,
                SUM(ST_Area(ST_Intersection(ST_Buffer(ST_Transform(sm.geom, 5070), $2), f.g5070))) AS covered_m2
          FROM landcover_streams_mouth sm, farm f
          WHERE sm.geom IS NOT NULL AND sm.geom && f.g4326 AND ST_Intersects(sm.geom, f.g4326)
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
      [JSON.stringify(boundaryGeoJSON), bufferMeters]
    );
  },

  // Percent-of-farm coverage for additional landcover-style layers.
  // Notes:
  // - Polygon geometries use true intersection area.
  // - Line/point geometries are buffered (meters) before computing area.
  getAdditionalLayerCoveragePercentsForGeoJSON: async (boundaryGeoJSON, bufferMeters = 10) => {
    if (typeof boundaryGeoJSON === 'string') {
      throw new Error('boundaryGeoJSON must be an object, not a pre-stringified JSON string');
    }
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
         FROM landcover_local_roads lr, farm f
         WHERE lr.geom IS NOT NULL AND lr.geom && f.g4326 AND ST_Intersects(lr.geom, f.g4326)

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
         FROM landcover_primary_roads pr, farm f
         WHERE pr.geom IS NOT NULL AND pr.geom && f.g4326 AND ST_Intersects(pr.geom, f.g4326)

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
         FROM landcover_roads_usace_ienc r, farm f
         WHERE r.geom IS NOT NULL AND r.geom && f.g4326 AND ST_Intersects(r.geom, f.g4326)

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
         FROM landcover_building_locations_usace_ienc b, farm f
         WHERE b.geom IS NOT NULL AND b.geom && f.g4326 AND ST_Intersects(b.geom, f.g4326)

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
         FROM landcover_landforms lf, farm f
         WHERE lf.geom IS NOT NULL AND lf.geom && f.g4326 AND ST_Intersects(lf.geom, f.g4326)

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
         FROM landcover_base_flood_elevations bfe, farm f
         WHERE bfe.geom IS NOT NULL AND bfe.geom && f.g4326 AND ST_Intersects(bfe.geom, f.g4326)

         UNION ALL
         SELECT 'landcover_coastlines'::text AS table_name,
                SUM(
                  ST_Area(
                    ST_Intersection(
                      CASE
                        WHEN ST_Dimension(c.geom) = 2 THEN ST_Transform(c.geom, 5070)
                        ELSE ST_Buffer(ST_Transform(c.geom, 5070), $2)
                      END,
                      f.g5070
                    )
                  )
                ) AS covered_m2
         FROM landcover_coastlines c, farm f
         WHERE c.geom IS NOT NULL AND c.geom && f.g4326 AND ST_Intersects(c.geom, f.g4326)
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
      [JSON.stringify(boundaryGeoJSON), bufferMeters]
    );
  },

  ensureFarmLandcoverReportsTable: async () => {
    return db.none(
      `CREATE TABLE IF NOT EXISTS farm_landcover_reports (
         id BIGSERIAL PRIMARY KEY,
         farm_id BIGINT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
         water_percent DOUBLE PRECISION,
         is_fully_water BOOLEAN,
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
    const isFullyWater = report?.water?.isFullyWater ?? null;
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

  // Get counties
  getCounties: async () => {
    return db.any(
      `SELECT id, name, fips_code
       FROM counties
       ORDER BY name`
    );
  },

  // Get cities by county
  getCitiesByCounty: async (countyId) => {
    return db.any(
      `SELECT id, name, population
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
