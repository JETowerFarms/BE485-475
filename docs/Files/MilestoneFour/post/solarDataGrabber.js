/**
 * Solar Data Grabber
 * Receives coordinate points and queries solar suitability data
 * Prepares all spatial filters and parameters internally before querying
 * Returns raw data for each point - scoring is handled by solarSuitabilityParser
 */

const { db } = require('../database');
const { addBatchData } = require('../../build/Release/solarSuitabilityParser.node');

/**
 * Query solar suitability data for multiple points
 * @param {Array<Array<number>>} points - Array of [lng, lat] coordinate pairs
 * @returns {Promise<Array<Object>>} Array of raw data objects for each point
 */
// Max points processed in parallel — each fires 7 DB queries, so
// CONCURRENCY_LIMIT * 7 must stay well under DB_MAX_CONNECTIONS.
const CONCURRENCY_LIMIT = 5;

/**
 * Run an async function over an array with bounded concurrency.
 */
async function mapConcurrent(arr, concurrency, fn) {
  const results = new Array(arr.length);
  let idx = 0;
  async function worker() {
    while (idx < arr.length) {
      const i = idx++;
      results[i] = await fn(arr[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, arr.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function querySolarDataForPoints(points, options = {}) {
  const skipNulls = Boolean(options.skipNulls);
  // Process points with bounded concurrency — avoids exhausting the DB connection pool
  const results = await mapConcurrent(points, CONCURRENCY_LIMIT, async ([lng, lat]) => {

      // ── All queries use $1/$2 parameterization for coordinates ──

      const nlcdQuery = `
        SELECT
          COALESCE(
            ST_Value(nlcd.rast, ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), ST_SRID(nlcd.rast))),
            ST_NearestValue(nlcd.rast, ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), ST_SRID(nlcd.rast)))
          ) AS nlcd_value,
          $1::float AS nlcd_lng,
          $2::float AS nlcd_lat
        FROM landcover_nlcd_2024_raster nlcd
        WHERE nlcd.rast && ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), ST_SRID(nlcd.rast))
        ORDER BY ST_Distance(
          ST_Centroid(ST_Envelope(nlcd.rast)),
          ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), ST_SRID(nlcd.rast))
        )
        LIMIT 1;
      `;

      const slopeQuery = `
        SELECT
          COALESCE(
            ST_Value(slope.rast, ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), ST_SRID(slope.rast))),
            ST_NearestValue(slope.rast, ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), ST_SRID(slope.rast)))
          ) AS slope_elevation,
          $1::float AS slope_lng,
          $2::float AS slope_lat
        FROM slope_raster slope
        WHERE slope.rast && ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), ST_SRID(slope.rast))
        ORDER BY ST_Distance(
          ST_Centroid(ST_Envelope(slope.rast)),
          ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), ST_SRID(slope.rast))
        )
        LIMIT 1;
      `;

      const popQuery = `
        SELECT
          COALESCE(
            ST_Value(pop.rast, ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), ST_SRID(pop.rast))),
            ST_NearestValue(pop.rast, ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), ST_SRID(pop.rast)))
          ) AS population_density,
          $1::float AS pop_lng,
          $2::float AS pop_lat
        FROM population_raster pop
        WHERE pop.rast && ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), ST_SRID(pop.rast))
        ORDER BY ST_Distance(
          ST_Centroid(ST_Envelope(pop.rast)),
          ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), ST_SRID(pop.rast))
        )
        LIMIT 1;
      `;

      const substationQuery = `
        SELECT
          ST_X(sub.geom) AS sub_lng,
          ST_Y(sub.geom) AS sub_lat,
          ST_Distance(sub.geom, ST_SetSRID(ST_Point($1, $2), 4326)) AS distance
        FROM substations sub
        ORDER BY sub.geom <-> ST_SetSRID(ST_Point($1, $2), 4326)
        LIMIT 1;
      `;

      const infraSearchRadius = 2500; // meters

      const buildingQuery = `
        SELECT
          COUNT(*) as total_building_count,
          COALESCE(SUM(ST_Area(ST_Intersection(b.geom, ST_Buffer(ST_SetSRID(ST_Point($1, $2), 4326)::geography, $3)::geometry))), 0) as building_area_sq_m
        FROM landcover_building_locations_usace_ienc b
        WHERE ST_DWithin(b.geom::geography, ST_SetSRID(ST_Point($1, $2), 4326)::geography, $3);
      `;

      const roadQuery = `
        SELECT
          COUNT(*) as total_road_count,
          COALESCE(SUM(ST_Length(ST_Intersection(r.geom, ST_Buffer(ST_SetSRID(ST_Point($1, $2), 4326)::geography, $3)::geometry))), 0) as road_length_m
        FROM (
          SELECT geom FROM landcover_local_roads
          UNION ALL
          SELECT geom FROM landcover_primary_roads
          UNION ALL
          SELECT geom FROM landcover_roads_usace_ienc
        ) r
        WHERE ST_DWithin(r.geom::geography, ST_SetSRID(ST_Point($1, $2), 4326)::geography, $3);
      `;

      const waterQuery = `
        SELECT
          COUNT(*) as total_water_count,
          COALESCE(SUM(ST_Area(ST_Intersection(w.geom, ST_Buffer(ST_SetSRID(ST_Point($1, $2), 4326)::geography, $3)::geometry))), 0) as water_area_sq_m
        FROM (
          SELECT geom FROM landcover_waterbody
          UNION ALL
          SELECT geom FROM landcover_lakes
          UNION ALL
          SELECT geom FROM landcover_river_areas
          UNION ALL
          SELECT geom FROM landcover_river_lines
          UNION ALL
          SELECT geom FROM landcover_streams_mouth
        ) w
        WHERE ST_DWithin(w.geom::geography, ST_SetSRID(ST_Point($1, $2), 4326)::geography, $3);
      `;

      // Execute all queries in parallel for this point
      const runInfraQuery = async (query, params, fallback) => {
        try {
          return await db.oneOrNone(query, params);
        } catch (err) {
          if (err && err.code === '42P01') {
            return fallback;
          }
          throw err;
        }
      };

      const coordParams = [lng, lat];
      const infraParams = [lng, lat, infraSearchRadius];

      const [nlcdResult, slopeResult, popResult, substationResult, buildingResult, roadResult, waterResult] = await Promise.all([
        db.oneOrNone(nlcdQuery, coordParams),
        db.oneOrNone(slopeQuery, coordParams),
        db.oneOrNone(popQuery, coordParams),
        db.oneOrNone(substationQuery, coordParams),
        runInfraQuery(buildingQuery, infraParams, { total_building_count: 0, building_area_sq_m: 0 }),
        runInfraQuery(roadQuery, infraParams, { total_road_count: 0, road_length_m: 0 }),
        runInfraQuery(waterQuery, infraParams, { total_water_count: 0, water_area_sq_m: 0 })
      ]);

      // Check for null values and throw errors
      if (!Number.isFinite(nlcdResult?.nlcd_value)) {
        if (skipNulls) return null;
        throw new Error(`NLCD value lookup failed for point (${lng}, ${lat})`);
      }
      if (!Number.isFinite(slopeResult?.slope_elevation)) {
        if (skipNulls) return null;
        throw new Error(`Slope elevation lookup failed for point (${lng}, ${lat})`);
      }
      if (!Number.isFinite(popResult?.population_density)) {
        if (skipNulls) return null;
        throw new Error(`Population density lookup failed for point (${lng}, ${lat})`);
      }
      if (!Number.isFinite(substationResult?.distance)) {
        if (skipNulls) return null;
        throw new Error(`Substation distance lookup failed for point (${lng}, ${lat})`);
      }

      const roadPresent =
        (roadResult?.total_road_count || 0) > 0 ||
        (roadResult?.road_length_m || 0) > 0;
      const waterPresent =
        (waterResult?.total_water_count || 0) > 0 ||
        (waterResult?.water_area_sq_m || 0) > 0;
      const hasInfrastructureOrWater =
        (buildingResult?.total_building_count || 0) > 0 ||
        (buildingResult?.building_area_sq_m || 0) > 0 ||
        roadPresent ||
        waterPresent;

      return {
        lng,
        lat,
        nlcd_value: nlcdResult?.nlcd_value || null,
        nlcd_lng: nlcdResult?.nlcd_lng || null,
        nlcd_lat: nlcdResult?.nlcd_lat || null,
        slope_elevation: slopeResult?.slope_elevation || null,
        slope_lng: slopeResult?.slope_lng || null,
        slope_lat: slopeResult?.slope_lat || null,
        population_density: popResult?.population_density || null,
        pop_lng: popResult?.pop_lng || null,
        pop_lat: popResult?.pop_lat || null,
        sub_lng: substationResult?.sub_lng || null,
        sub_lat: substationResult?.sub_lat || null,
        sub_distance: substationResult?.distance || null,
        infra_or_water: hasInfrastructureOrWater ? 1 : 0,
        road_present: roadPresent ? 1 : 0,
        water_present: waterPresent ? 1 : 0
      };
  });

  const filtered = results.filter(Boolean);

  // Send raw data to parser for accumulation
  if (filtered.length > 0) {
    addBatchData(filtered);
  }

  return filtered;
}

/**
 * Query solar suitability data for a single point (backward compatibility)
 * @param {number} lng - Longitude
 * @param {number} lat - Latitude
 * @returns {Promise<Object>} Raw data object
 */
async function querySolarDataForPoint(lng, lat) {
  const results = await querySolarDataForPoints([[lng, lat]]);
  return results[0];
}

module.exports = {
  querySolarDataForPoints,
  querySolarDataForPoint
};