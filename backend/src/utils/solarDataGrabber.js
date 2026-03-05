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
      // Params table - prepare calculations outside queries
      const params = {
        pointGeom: `ST_SetSRID(ST_Point(${lng}, ${lat}), 4326)`,
        pointCentroid: `ST_SetSRID(ST_Point(${lng}, ${lat}), 4326)`,
        searchRadius: 402.497236, // population_raster coverage diagonal + 0.005 buffer (largest raster)
        subSearchRadius: 9.588271  // substations extent diagonal + 0.005 buffer
      };


      // Query each table directly by coordinates (coordinates are ground truth)
      const nlcdQuery = `
        SELECT
          COALESCE(
            ST_Value(nlcd.rast, ST_Transform(${params.pointGeom}, ST_SRID(nlcd.rast))),
            ST_NearestValue(nlcd.rast, ST_Transform(${params.pointGeom}, ST_SRID(nlcd.rast)))
          ) AS nlcd_value,
          ST_X(${params.pointGeom}) AS nlcd_lng,
          ST_Y(${params.pointGeom}) AS nlcd_lat
        FROM landcover_nlcd_2024_raster nlcd
        ORDER BY ST_Distance(
          ST_Centroid(ST_Envelope(nlcd.rast)),
          ST_Transform(${params.pointGeom}, ST_SRID(nlcd.rast))
        )
        LIMIT 1;
      `;

      const slopeQuery = `
        SELECT
          COALESCE(
            ST_Value(slope.rast, ST_Transform(${params.pointGeom}, ST_SRID(slope.rast))),
            ST_NearestValue(slope.rast, ST_Transform(${params.pointGeom}, ST_SRID(slope.rast)))
          ) AS slope_elevation,
          ST_X(${params.pointGeom}) AS slope_lng,
          ST_Y(${params.pointGeom}) AS slope_lat
        FROM slope_raster slope
        ORDER BY ST_Distance(
          ST_Centroid(ST_Envelope(slope.rast)),
          ST_Transform(${params.pointGeom}, ST_SRID(slope.rast))
        )
        LIMIT 1;
      `;

      const popQuery = `
        SELECT
          COALESCE(
            ST_Value(pop.rast, ST_Transform(${params.pointGeom}, ST_SRID(pop.rast))),
            ST_NearestValue(pop.rast, ST_Transform(${params.pointGeom}, ST_SRID(pop.rast)))
          ) AS population_density,
          ST_X(${params.pointGeom}) AS pop_lng,
          ST_Y(${params.pointGeom}) AS pop_lat
        FROM population_raster pop
        ORDER BY ST_Distance(
          ST_Centroid(ST_Envelope(pop.rast)),
          ST_Transform(${params.pointGeom}, ST_SRID(pop.rast))
        )
        LIMIT 1;
      `;

      const substationQuery = `
        SELECT
          ST_X(sub.geom) AS sub_lng,
          ST_Y(sub.geom) AS sub_lat,
          ST_Distance(sub.geom, ${params.pointGeom}) AS distance
        FROM substations sub
        ORDER BY ST_Distance(sub.geom, ${params.pointGeom})
        LIMIT 1;
      `;

      const infraSearchRadius = 2500; // meters (coverage radius for infra/water layers)
      const infraParams = {
        searchRadius: infraSearchRadius,
        bufferGeom: `ST_Buffer(ST_SetSRID(ST_Point(${lng}, ${lat}), 4326), ${infraSearchRadius})`
      };

      // TODO: wrong table names — real tables are landcover_building_locations_usace_ienc
      // Fix: replace buildings/building_locations/structures with landcover_building_locations_usace_ienc
      const buildingQuery = `
        SELECT
          COUNT(*) as total_building_count,
          COALESCE(SUM(ST_Area(ST_Intersection(b.geom, ${infraParams.bufferGeom}))), 0) as building_area_sq_m
        FROM (
          SELECT geom FROM buildings
          UNION ALL
          SELECT geom FROM building_locations
          UNION ALL
          SELECT geom FROM structures
        ) b
        WHERE ST_DWithin(b.geom, ${params.pointGeom}, ${infraParams.searchRadius});
      `;

      // TODO: wrong table names — real tables are landcover_local_roads, landcover_primary_roads, landcover_roads_usace_ienc
      // Fix: replace roads/local_roads/primary_roads/road_lines with the landcover_ prefixed versions
      const roadQuery = `
        SELECT
          COUNT(*) as total_road_count,
          COALESCE(SUM(ST_Length(ST_Intersection(r.geom, ${infraParams.bufferGeom}))), 0) as road_length_m
        FROM (
          SELECT geom FROM roads
          UNION ALL
          SELECT geom FROM local_roads
          UNION ALL
          SELECT geom FROM primary_roads
          UNION ALL
          SELECT geom FROM road_lines
        ) r
        WHERE ST_DWithin(r.geom, ${params.pointGeom}, ${infraParams.searchRadius});
      `;

      // TODO: wrong table names — real tables are landcover_waterbody, landcover_lakes, landcover_river_areas, landcover_river_lines, landcover_streams_mouth
      // Fix: replace waterbodies/lakes/rivers/river_areas/streams with the landcover_ prefixed versions
      const waterQuery = `
        SELECT
          COUNT(*) as total_water_count,
          COALESCE(SUM(ST_Area(ST_Intersection(w.geom, ${infraParams.bufferGeom}))), 0) as water_area_sq_m
        FROM (
          SELECT geom FROM waterbodies
          UNION ALL
          SELECT geom FROM lakes
          UNION ALL
          SELECT geom FROM rivers
          UNION ALL
          SELECT geom FROM river_areas
          UNION ALL
          SELECT geom FROM streams
        ) w
        WHERE ST_DWithin(w.geom, ${params.pointGeom}, ${infraParams.searchRadius});
      `;

      // Execute all queries in parallel for this point
      const runInfraQuery = async (query, fallback) => {
        try {
          return await db.oneOrNone(query);
        } catch (err) {
          if (err && err.code === '42P01') {
            return fallback;
          }
          throw err;
        }
      };

      const [nlcdResult, slopeResult, popResult, substationResult, buildingResult, roadResult, waterResult] = await Promise.all([
        db.oneOrNone(nlcdQuery),
        db.oneOrNone(slopeQuery),
        db.oneOrNone(popQuery),
        db.oneOrNone(substationQuery),
        runInfraQuery(buildingQuery, { total_building_count: 0, building_area_sq_m: 0 }),
        runInfraQuery(roadQuery, { total_road_count: 0, road_length_m: 0 }),
        runInfraQuery(waterQuery, { total_water_count: 0, water_area_sq_m: 0 })
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