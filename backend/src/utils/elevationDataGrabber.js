/**
 * Elevation Data Grabber
 * Receives coordinate points and queries elevation data
 * Prepares all spatial filters and parameters internally before querying
 * Sends processed data to elevationHeatMapParser for heatmap generation
 */

const { db } = require('../database');
const { addBatchData } = require('./elevationHeatMapParser');

/**
 * Query elevation data for multiple points
 * @param {Array<Array<number>>} points - Array of [lng, lat] coordinate pairs
 * @returns {Promise<void>} Sends data to parser, no return value
 */
async function queryElevationDataForPoints(points) {
  // Process all points in parallel
  const results = await Promise.all(
    points.map(async ([lng, lat]) => {
      // Params table - prepare calculations outside queries
      const params = {
        pointGeom: `ST_SetSRID(ST_Point(${lng}, ${lat}), 4326)`,
        pointCentroid: `ST_SetSRID(ST_Point(${lng}, ${lat}), 4326)`,
        searchRadius: 12.869787  // elevation_raster coverage diagonal + 0.005 buffer
      };

      // Query elevation raster directly by coordinates
      const elevationQuery = `
        WITH pt AS (
          SELECT ST_Transform(${params.pointGeom}, 5070) AS geom
        ), hit AS (
          SELECT ST_Value(elev.rast, pt.geom) AS val
          FROM elevation_raster elev, pt
          WHERE ST_Intersects(elev.rast, pt.geom)
          ORDER BY ST_Distance(ST_Centroid(ST_Envelope(elev.rast)), pt.geom)
          LIMIT 1
        ), nearest AS (
          SELECT ST_NearestValue(elev.rast, pt.geom) AS val
          FROM elevation_raster elev, pt
          ORDER BY ST_Distance(ST_Centroid(ST_Envelope(elev.rast)), pt.geom)
          LIMIT 1
        )
        SELECT
          COALESCE((SELECT val FROM hit), (SELECT val FROM nearest)) AS elevation,
          ST_X(${params.pointGeom}) AS elev_lng,
          ST_Y(${params.pointGeom}) AS elev_lat;
      `;

      // Execute the query
      const elevationResult = await db.oneOrNone(elevationQuery);

      // Check for null values and fallback to 0 to avoid hard failure
      if (!elevationResult || elevationResult.elevation === null) {
        console.error(`Elevation data lookup failed for point (${lng}, ${lat}); defaulting to 0`);
      }

      return {
        lng,
        lat,
        elevation: elevationResult?.elevation ?? 0,
        elev_lng: elevationResult?.elev_lng ?? null,
        elev_lat: elevationResult?.elev_lat ?? null
      };
    })
  );

  // Send data to parser for processing
  addBatchData(results);
}

/**
 * Query elevation data for a single point (backward compatibility)
 * @param {number} lng - Longitude
 * @param {number} lat - Latitude
 * @returns {Promise<void>} Sends data to parser
 */
async function queryElevationDataForPoint(lng, lat) {
  await queryElevationDataForPoints([[lng, lat]]);
}

module.exports = {
  queryElevationDataForPoints,
  queryElevationDataForPoint
};