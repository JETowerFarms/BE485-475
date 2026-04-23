/**
 * Elevation Data Grabber — v2 (clip-once-per-batch)
 *
 * Uses the same clip-once CTE strategy as solarDataGrabber: clip the elevation raster
 * to the batch bbox ONCE, then ST_Value per point against the merged in-memory raster.
 *
 * Replaces the previous per-point implementation (one DB query per point).
 */

const { db } = require('../database');
const { addBatchData } = require('./elevationHeatMapParser');

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

async function queryElevationDataForPoints(points) {
  if (!Array.isArray(points) || points.length === 0) {
    addBatchData([]);
    return;
  }

  const lngs = points.map((p) => Number(p[0]));
  const lats = points.map((p) => Number(p[1]));
  const [minLng, minLat, maxLng, maxLat] = bbox(points);

  const sql = `
    WITH bbox AS (
      SELECT ST_MakeEnvelope($3, $4, $5, $6, 4326) AS g
    ),
    clipped AS MATERIALIZED (
      SELECT ST_Union(ST_Clip(r.rast, ST_Transform(b.g, ST_SRID(r.rast)), true)) AS rast
      FROM elevation_raster r, bbox b
      WHERE r.rast && ST_Transform(b.g, ST_SRID(r.rast))
    ),
    pts AS (
      SELECT ord AS idx, lng, lat
      FROM unnest($1::float[], $2::float[]) WITH ORDINALITY AS t(lng, lat, ord)
    )
    SELECT p.idx,
      ST_Value(c.rast, ST_Transform(ST_SetSRID(ST_Point(p.lng, p.lat), 4326), ST_SRID(c.rast)), true) AS elevation
    FROM pts p CROSS JOIN clipped c
    ORDER BY p.idx
  `;

  const t0 = Date.now();
  const rows = await db.any(sql, [lngs, lats, minLng, minLat, maxLng, maxLat]);
  if (LOG_TIMING) console.log(`[elev] ${Date.now() - t0}ms rows=${rows.length} points=${points.length}`);

  const byIdx = new Map();
  for (const r of rows) byIdx.set(Number(r.idx), r);

  const results = points.map((pt, i) => {
    const idx = i + 1;
    const row = byIdx.get(idx);
    const elev = Number.isFinite(row?.elevation) ? row.elevation : 0;
    return {
      lng: pt[0],
      lat: pt[1],
      elevation: elev,
      elev_lng: pt[0],
      elev_lat: pt[1],
    };
  });

  addBatchData(results);
}

async function queryElevationDataForPoint(lng, lat) {
  await queryElevationDataForPoints([[lng, lat]]);
}

module.exports = {
  queryElevationDataForPoints,
  queryElevationDataForPoint,
};
