/**
 * Clearing Cost Data Grabber — v2 (clip-once-per-batch)
 *
 * Bulk-queries NLCD + slope rasters per batch (merged tiles) and returns the
 * same shape the parser expects. Building/road/water tables don't currently
 * exist in production — we skip those queries entirely (saves ~120ms/batch).
 */

const { db } = require('../database');

const LOG_TIMING = process.env.GRABBER_TIMING !== '0';

function bbox(points) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const pad = 0.001;
  return [minLng - pad, minLat - pad, maxLng + pad, maxLat + pad];
}

function rasterClipOnceSql(table, valueCol) {
  return `
    WITH bbox AS (
      SELECT ST_MakeEnvelope($3, $4, $5, $6, 4326) AS g
    ),
    clipped AS MATERIALIZED (
      SELECT ST_Union(ST_Clip(r.rast, ST_Transform(b.g, ST_SRID(r.rast)), true)) AS rast
      FROM ${table} r, bbox b
      WHERE r.rast && ST_Transform(b.g, ST_SRID(r.rast))
    ),
    pts AS (
      SELECT ord AS idx, lng, lat
      FROM unnest($1::float[], $2::float[]) WITH ORDINALITY AS t(lng, lat, ord)
    )
    SELECT p.idx,
      ST_Value(c.rast, ST_Transform(ST_SetSRID(ST_Point(p.lng, p.lat), 4326), ST_SRID(c.rast)), true) AS ${valueCol}
    FROM pts p CROSS JOIN clipped c
    ORDER BY p.idx
  `;
}

async function timed(label, promise) {
  const t0 = Date.now();
  try {
    const rows = await promise;
    if (LOG_TIMING) console.log(`[clearing] ${label} ${Date.now() - t0}ms rows=${Array.isArray(rows) ? rows.length : 'n/a'}`);
    return rows;
  } catch (e) {
    if (LOG_TIMING) console.log(`[clearing] ${label} ERR ${Date.now() - t0}ms ${e.code || ''} ${e.message}`);
    throw e;
  }
}

async function queryClearingCostDataForPoints(points, options = {}) {
  const { includePricingSnapshots = true } = options;
  if (!Array.isArray(points) || points.length === 0) {
    return { clearingData: [], pricingSnapshots: includePricingSnapshots ? await getAllPricingSnapshots() : [] };
  }

  const lngs = points.map((p) => Number(p[0]));
  const lats = points.map((p) => Number(p[1]));
  const [minLng, minLat, maxLng, maxLat] = bbox(points);
  const rasterArgs = [lngs, lats, minLng, minLat, maxLng, maxLat];
  const searchRadius = 2500;
  const bufferArea = Math.PI * searchRadius * searchRadius;

  const [nlcdRows, slopeRows, pricingSnapshots] = await Promise.all([
    timed('nlcd', db.any(rasterClipOnceSql('landcover_nlcd_2024_raster', 'nlcd_value'), rasterArgs)),
    timed('slope', db.any(rasterClipOnceSql('slope_raster', 'slope_value'), rasterArgs)),
    includePricingSnapshots ? getAllPricingSnapshots() : Promise.resolve([]),
  ]);

  const byIdx = (rows) => {
    const m = new Map();
    for (const r of rows) m.set(Number(r.idx), r);
    return m;
  };
  const nlcdMap = byIdx(nlcdRows);
  const slopeMap = byIdx(slopeRows);

  const clearingData = points.map((pt, i) => {
    const idx = i + 1;
    const n = nlcdMap.get(idx);
    const s = slopeMap.get(idx);
    const nlcdVal = Number.isFinite(n?.nlcd_value) ? n.nlcd_value : null;
    const slopeVal = Number.isFinite(s?.slope_value) ? s.slope_value : null;
    return {
      lng: pt[0],
      lat: pt[1],
      nlcd_value: nlcdVal,
      nlcd_lng: pt[0],
      nlcd_lat: pt[1],
      slope_value: slopeVal,
      // Infrastructure/water tables not in this deployment — return zeros.
      building_coverage: 0,
      building_count: 0,
      road_coverage: 0,
      road_count: 0,
      water_coverage: 0,
      water_count: 0,
      search_radius_m: searchRadius,
      buffer_area_sq_m: bufferArea,
    };
  });

  return { clearingData, pricingSnapshots };
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