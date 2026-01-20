/**
 * Clearing Cost Data Grabber
 * Receives coordinate points and queries clearing cost related data
 * Audits all landcover tables for comprehensive coverage analysis
 * Returns raw data for each point - cost calculations handled by clearingCostParser
 */

const { db } = require('../database');

/**
 * Query clearing cost data for multiple points
 * @param {Array<Array<number>>} points - Array of [lng, lat] coordinate pairs
 * @returns {Promise<Array<Object>>} Array of raw data objects for each point
 */
async function queryClearingCostDataForPoints(points, options = {}) {
  const { includePricingSnapshots = true } = options;
  // Process all points in parallel
  const results = await Promise.all(
    points.map(async ([lng, lat]) => {
      // Params table - prepare calculations outside queries
      const params = {
        pointGeom: `ST_SetSRID(ST_Point(${lng}, ${lat}), 4326)`,
        pointCentroid: `ST_SetSRID(ST_Point(${lng}, ${lat}), 4326)`,
        searchRadius: 2500, // Reasonable local search radius in meters for infrastructure analysis
        bufferGeom: `ST_Buffer(ST_SetSRID(ST_Point(${lng}, ${lat}), 4326), 2500)` // 2.5km buffer for local coverage
      };

      // Query NLCD land cover (same as solar data grabber)
      const nlcdQuery = `
        SELECT
          ST_Value(nlcd.rast, ST_Transform(${params.pointGeom}, ST_SRID(nlcd.rast))) AS nlcd_value,
          ST_X(${params.pointGeom}) AS nlcd_lng,
          ST_Y(${params.pointGeom}) AS nlcd_lat
        FROM landcover_nlcd_2024_raster nlcd
        WHERE ST_Distance(
          ST_Centroid(ST_Envelope(nlcd.rast)),
          ST_Transform(${params.pointGeom}, ST_SRID(nlcd.rast))
        ) <= 73.116169
        ORDER BY ST_Distance(
          ST_Centroid(ST_Envelope(nlcd.rast)),
          ST_Transform(${params.pointGeom}, ST_SRID(nlcd.rast))
        )
        LIMIT 1;
      `;

      const slopeQuery = `
        SELECT
          ST_Value(slope.rast, ST_Transform(${params.pointGeom}, ST_SRID(slope.rast))) AS slope_value
        FROM slope_raster slope
        WHERE ST_Distance(
          ST_Centroid(ST_Envelope(slope.rast)),
          ST_Transform(${params.pointGeom}, ST_SRID(slope.rast))
        ) <= 73.326366
        ORDER BY ST_Distance(
          ST_Centroid(ST_Envelope(slope.rast)),
          ST_Transform(${params.pointGeom}, ST_SRID(slope.rast))
        )
        LIMIT 1;
      `;

      // Query building coverage from all building-related tables
      const buildingQuery = `
        SELECT
          COUNT(*) as total_building_count,
          COALESCE(SUM(ST_Area(ST_Intersection(b.geom, ${params.bufferGeom}))), 0) as building_area_sq_m,
          ST_Area(${params.bufferGeom}) as buffer_area_sq_m
        FROM (
          SELECT geom FROM buildings
          UNION ALL
          SELECT geom FROM building_locations
          UNION ALL
          SELECT geom FROM structures
        ) b
        WHERE ST_DWithin(b.geom, ${params.pointGeom}, ${params.searchRadius});
      `;

      // Query road coverage from all road-related tables
      const roadQuery = `
        SELECT
          COUNT(*) as total_road_count,
          COALESCE(SUM(ST_Length(ST_Intersection(r.geom, ${params.bufferGeom}))), 0) as road_length_m,
          ST_Area(${params.bufferGeom}) as buffer_area_sq_m
        FROM (
          SELECT geom FROM roads
          UNION ALL
          SELECT geom FROM local_roads
          UNION ALL
          SELECT geom FROM primary_roads
          UNION ALL
          SELECT geom FROM road_lines
        ) r
        WHERE ST_DWithin(r.geom, ${params.pointGeom}, ${params.searchRadius});
      `;

      // Query water coverage from all water-related tables
      const waterQuery = `
        SELECT
          COUNT(*) as total_water_count,
          COALESCE(SUM(ST_Area(ST_Intersection(w.geom, ${params.bufferGeom}))), 0) as water_area_sq_m,
          ST_Area(${params.bufferGeom}) as buffer_area_sq_m
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
        WHERE ST_DWithin(w.geom, ${params.pointGeom}, ${params.searchRadius});
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

      const [nlcdResult, slopeResult, buildingResult, roadResult, waterResult] = await Promise.all([
        db.oneOrNone(nlcdQuery),
        db.oneOrNone(slopeQuery),
        runInfraQuery(buildingQuery, { total_building_count: 0, building_area_sq_m: 0, buffer_area_sq_m: null }),
        runInfraQuery(roadQuery, { total_road_count: 0, road_length_m: 0, buffer_area_sq_m: null }),
        runInfraQuery(waterQuery, { total_water_count: 0, water_area_sq_m: 0, buffer_area_sq_m: null })
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
        search_radius_m: params.searchRadius,
        buffer_area_sq_m: bufferAreaSqM
      };
    })
  );

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