/**
 * Clearing Cost Data Grabber
 * Receives coordinate points and queries clearing cost related data
 * Audits all landcover tables for comprehensive coverage analysis
 * Returns raw data for each point - cost calculations handled by clearingCostParser
 */

const { db } = require('../database');

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

/**
 * Query clearing cost data for multiple points
 * @param {Array<Array<number>>} points - Array of [lng, lat] coordinate pairs
 * @returns {Promise<Array<Object>>} Array of raw data objects for each point
 */
async function queryClearingCostDataForPoints(points, options = {}) {
  const { includePricingSnapshots = true } = options;
  const searchRadius = 2500; // meters

  const results = await mapConcurrent(points, CONCURRENCY_LIMIT, async ([lng, lat]) => {
      const nlcdQuery = `
        SELECT
          ST_Value(nlcd.rast, ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), ST_SRID(nlcd.rast))) AS nlcd_value,
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
          ST_Value(slope.rast, ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), ST_SRID(slope.rast))) AS slope_value
        FROM slope_raster slope
        WHERE slope.rast && ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), ST_SRID(slope.rast))
        ORDER BY ST_Distance(
          ST_Centroid(ST_Envelope(slope.rast)),
          ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), ST_SRID(slope.rast))
        )
        LIMIT 1;
      `;

      const buildingQuery = `
        SELECT
          COUNT(*) as total_building_count,
          COALESCE(SUM(ST_Area(ST_Intersection(b.geom, ST_Buffer(ST_SetSRID(ST_Point($1, $2), 4326)::geography, $3)::geometry))), 0) as building_area_sq_m,
          ST_Area(ST_Buffer(ST_SetSRID(ST_Point($1, $2), 4326)::geography, $3)::geometry) as buffer_area_sq_m
        FROM landcover_building_locations_usace_ienc b
        WHERE ST_DWithin(b.geom::geography, ST_SetSRID(ST_Point($1, $2), 4326)::geography, $3);
      `;

      const roadQuery = `
        SELECT
          COUNT(*) as total_road_count,
          COALESCE(SUM(ST_Length(ST_Intersection(r.geom, ST_Buffer(ST_SetSRID(ST_Point($1, $2), 4326)::geography, $3)::geometry))), 0) as road_length_m,
          ST_Area(ST_Buffer(ST_SetSRID(ST_Point($1, $2), 4326)::geography, $3)::geometry) as buffer_area_sq_m
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
          COALESCE(SUM(ST_Area(ST_Intersection(w.geom, ST_Buffer(ST_SetSRID(ST_Point($1, $2), 4326)::geography, $3)::geometry))), 0) as water_area_sq_m,
          ST_Area(ST_Buffer(ST_SetSRID(ST_Point($1, $2), 4326)::geography, $3)::geometry) as buffer_area_sq_m
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
      const infraParams = [lng, lat, searchRadius];

      const [nlcdResult, slopeResult, buildingResult, roadResult, waterResult] = await Promise.all([
        db.oneOrNone(nlcdQuery, coordParams),
        db.oneOrNone(slopeQuery, coordParams),
        runInfraQuery(buildingQuery, infraParams, { total_building_count: 0, building_area_sq_m: 0, buffer_area_sq_m: null }),
        runInfraQuery(roadQuery, infraParams, { total_road_count: 0, road_length_m: 0, buffer_area_sq_m: null }),
        runInfraQuery(waterQuery, infraParams, { total_water_count: 0, water_area_sq_m: 0, buffer_area_sq_m: null })
      ]);

      // Calculate coverage percentages
      const bufferAreaSqM = buildingResult?.buffer_area_sq_m || roadResult?.buffer_area_sq_m || waterResult?.buffer_area_sq_m || 10000;
      const buildingCoverage = bufferAreaSqM > 0 ? ((buildingResult?.building_area_sq_m || 0) / bufferAreaSqM) * 100 : 0;
      const roadCoverage = bufferAreaSqM > 0 ? ((roadResult?.road_length_m || 0) / Math.sqrt(bufferAreaSqM)) * 100 : 0; // Normalize road length to coverage %
      const waterCoverage = bufferAreaSqM > 0 ? ((waterResult?.water_area_sq_m || 0) / bufferAreaSqM) * 100 : 0;

      // Check for null values and throw errors
      if (nlcdResult?.nlcd_value === null) {
        throw new Error(`NLCD value lookup failed for point (${lng}, ${lat})`);
      }

      return {
        lng,
        lat,
        nlcd_value: nlcdResult?.nlcd_value || null,
        nlcd_lng: nlcdResult?.nlcd_lng || null,
        nlcd_lat: nlcdResult?.nlcd_lat || null,
        slope_value: slopeResult?.slope_value ?? null,
        building_coverage: buildingCoverage,
        building_count: buildingResult?.total_building_count || 0,
        road_coverage: roadCoverage,
        road_count: roadResult?.total_road_count || 0,
        water_coverage: waterCoverage,
        water_count: waterResult?.total_water_count || 0,
        search_radius_m: searchRadius,
        buffer_area_sq_m: bufferAreaSqM
      };
  });

  // Optionally fetch pricing snapshots (avoid per-batch DB hits)
  const pricingSnapshots = includePricingSnapshots ? await getAllPricingSnapshots() : [];

  return {
    clearingData: results,
    pricingSnapshots: pricingSnapshots
  };
}

/**
 * Query clearing cost data for a single point (backward compatibility)
 * @param {number} lng - Longitude
 * @param {number} lat - Latitude
 * @returns {Promise<Object>} Raw data object with clearing data and pricing snapshots
 */
async function queryClearingCostDataForPoint(lng, lat) {
  const result = await queryClearingCostDataForPoints([[lng, lat]]);
  return {
    ...result.clearingData[0],
    pricingSnapshots: result.pricingSnapshots
  };
}

/**
 * Get clearing cost analysis results from the parser
 * @returns {Promise<Object>} Results object with individual results and summary
 */
async function getClearingCostResults() {
  const { getClearingCostResults } = require('../../build/Release/clearingCostParser.node');
  return getClearingCostResults();
}

/**
 * Get all pricing snapshot data from the database
 * @returns {Promise<Array<Object>>} Array of pricing snapshot records with all prices
 */
async function getAllPricingSnapshots() {
  const query = `
    SELECT
      id,
      snapshot_key,
      payload,
      retrieved_at
    FROM pricing_snapshots
    ORDER BY retrieved_at DESC;
  `;

  const results = await db.any(query);

  // Transform results to include parsed payload data
  return results.map(snapshot => ({
    id: snapshot.id,
    snapshotKey: snapshot.snapshot_key,
    retrievedAt: snapshot.retrieved_at,
    payload: snapshot.payload,
    // Extract pricing data for easier access
    sources: snapshot.payload?.sources || null,
    msuRates: snapshot.payload?.sources?.msu?.extractedRatesUsdPerAcre || null,
    mdotItems: snapshot.payload?.sources?.mdot?.extractedItems || null
  }));
}

/**
 * Get probabilistic expected values used in calculations
 * @returns {Promise<Object>} Expected values from probabilistic model
 */
async function getExpectedValues() {
  const { getExpectedValues } = require('../../build/Release/clearingCostParser.node');
  return getExpectedValues();
}

module.exports = {
  queryClearingCostDataForPoints,
  queryClearingCostDataForPoint,
  getClearingCostResults,
  getExpectedValues,
  getAllPricingSnapshots
};