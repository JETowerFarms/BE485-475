/**
 * Solar Data Grabber — v3 (clip-once-per-batch)
 *
 * Strategy: For each batch of N points we:
 *   1. Compute the batch bounding box (adds small buffer).
 *   2. Clip every raster table to that bbox ONCE — union matching tiles into a single raster.
 *      PostgreSQL materializes this result in a CTE and reuses it 100 times.
 *   3. Call ST_Value against the single clipped raster per point (tile already in memory).
 *
 * This avoids the dominant cost we observed: 100 points × tile I/O per ST_Value call.
 * With clip-once, we pay tile I/O ONCE per batch regardless of batch size.
 *
 * Each query logs its wall-clock time so we can see live bottlenecks.
 */

const { db } = require('../database');
const { addBatchData } = require('../../build/Release/solarSuitabilityParser.node');

const LOG_TIMING = process.env.GRABBER_TIMING !== '0';

async function timedQuery(label, sql, params) {
  const t0 = Date.now();
  try {
    const rows = await db.any(sql, params);
    const dt = Date.now() - t0;
    if (LOG_TIMING) console.log(`[grabber] ${label} ${dt}ms rows=${rows.length}`);
    return rows;
  } catch (e) {
    const dt = Date.now() - t0;
    if (LOG_TIMING) console.log(`[grabber] ${label} ERR ${dt}ms ${e.code || ''} ${e.message}`);
    throw e;
  }
}

// Fallback handler for optional vector tables that may not exist (42P01).
async function safeBulk(label, query, params, fallback) {
  try {
    return await timedQuery(label, query, params);
  } catch (err) {
    if (err && err.code === '42P01') return fallback;
    throw err;
  }
}

// Check once (cached) whether optional landcover vector tables exist in the DB.
// Skipping non-existent tables saves ~120ms/batch of wasted failing queries.
let _vectorTableAvailabilityPromise = null;
async function getVectorTableAvailability() {
  if (!_vectorTableAvailabilityPromise) {
    _vectorTableAvailabilityPromise = (async () => {
      const sql = `
        SELECT to_regclass('public.buildings') IS NOT NULL
            OR to_regclass('public.building_locations') IS NOT NULL
            OR to_regclass('public.structures') IS NOT NULL AS buildings,
               to_regclass('public.roads') IS NOT NULL
            OR to_regclass('public.local_roads') IS NOT NULL
            OR to_regclass('public.primary_roads') IS NOT NULL
            OR to_regclass('public.road_lines') IS NOT NULL AS roads,
               to_regclass('public.waterbodies') IS NOT NULL
            OR to_regclass('public.lakes') IS NOT NULL
            OR to_regclass('public.rivers') IS NOT NULL
            OR to_regclass('public.river_areas') IS NOT NULL
            OR to_regclass('public.streams') IS NOT NULL AS water
      `;
      try {
        const row = await db.one(sql);
        if (LOG_TIMING) {
          console.log(`[grabber] vector_tables buildings=${row.buildings} roads=${row.roads} water=${row.water}`);
        }
        return { buildings: !!row.buildings, roads: !!row.roads, water: !!row.water };
      } catch (_) {
        return { buildings: false, roads: false, water: false };
      }
    })();
  }
  return _vectorTableAvailabilityPromise;
}

function bbox(points) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  // ~100m buffer in degrees
  const pad = 0.001;
  return [minLng - pad, minLat - pad, maxLng + pad, maxLat + pad];
}

async function querySolarDataForPoints(points, options = {}) {
  const skipNulls = Boolean(options.skipNulls);
  if (!Array.isArray(points) || points.length === 0) return [];

  const lngs = points.map((p) => Number(p[0]));
  const lats = points.map((p) => Number(p[1]));
  const [minLng, minLat, maxLng, maxLat] = bbox(points);
  const infraSearchRadius = 2500; // meters

  // Raster clip-once CTE template. ST_Union merges all tiles intersecting bbox into ONE raster.
  // Then every LATERAL call hits that single in-memory raster → no more per-point tile I/O.
  const rasterQuery = (table, valueCol) => `
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

  const nlcdSql = rasterQuery('landcover_nlcd_2024_raster', 'nlcd_value');
  const slopeSql = rasterQuery('slope_raster', 'slope_elevation');
  const popSql = rasterQuery('population_raster', 'population_density');

  // Substation — KNN; small table, fast index lookup.
  const subSql = `
    WITH pts AS (
      SELECT ord AS idx, lng, lat
      FROM unnest($1::float[], $2::float[]) WITH ORDINALITY AS t(lng, lat, ord)
    )
    SELECT p.idx,
      s.sub_lng, s.sub_lat, s.distance AS sub_distance
    FROM pts p
    LEFT JOIN LATERAL (
      SELECT ST_X(geom) AS sub_lng, ST_Y(geom) AS sub_lat,
             ST_Distance(geom, ST_SetSRID(ST_Point(p.lng, p.lat), 4326)) AS distance
      FROM substations
      ORDER BY geom <-> ST_SetSRID(ST_Point(p.lng, p.lat), 4326)
      LIMIT 1
    ) s ON true
    ORDER BY p.idx
  `;

  // Vector aggregate queries over optional tables (safeBulk handles missing tables).
  // Uses `&&` bbox op which uses GIST index, vs ST_DWithin which may not.
  const buildingSql = `
    WITH pts AS (
      SELECT ord AS idx, lng, lat
      FROM unnest($1::float[], $2::float[]) WITH ORDINALITY AS t(lng, lat, ord)
    ),
    pts_g AS (
      SELECT idx, ST_SetSRID(ST_Point(lng, lat), 4326) AS g,
             ST_Buffer(ST_SetSRID(ST_Point(lng, lat), 4326)::geography, ${infraSearchRadius})::geometry AS buf
      FROM pts
    )
    SELECT p.idx,
      COALESCE(agg.cnt, 0)::int AS total_building_count,
      COALESCE(agg.area, 0) AS building_area_sq_m
    FROM pts_g p
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt, SUM(ST_Area(ST_Intersection(b.geom, p.buf)::geography)) AS area
      FROM (
        SELECT geom FROM buildings
        UNION ALL SELECT geom FROM building_locations
        UNION ALL SELECT geom FROM structures
      ) b
      WHERE b.geom && p.buf
    ) agg ON true
    ORDER BY p.idx
  `;

  const roadSql = `
    WITH pts AS (
      SELECT ord AS idx, lng, lat
      FROM unnest($1::float[], $2::float[]) WITH ORDINALITY AS t(lng, lat, ord)
    ),
    pts_g AS (
      SELECT idx, ST_SetSRID(ST_Point(lng, lat), 4326) AS g,
             ST_Buffer(ST_SetSRID(ST_Point(lng, lat), 4326)::geography, ${infraSearchRadius})::geometry AS buf
      FROM pts
    )
    SELECT p.idx,
      COALESCE(agg.cnt, 0)::int AS total_road_count,
      COALESCE(agg.len, 0) AS road_length_m
    FROM pts_g p
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt, SUM(ST_Length(ST_Intersection(r.geom, p.buf)::geography)) AS len
      FROM (
        SELECT geom FROM roads
        UNION ALL SELECT geom FROM local_roads
        UNION ALL SELECT geom FROM primary_roads
        UNION ALL SELECT geom FROM road_lines
      ) r
      WHERE r.geom && p.buf
    ) agg ON true
    ORDER BY p.idx
  `;

  const waterSql = `
    WITH pts AS (
      SELECT ord AS idx, lng, lat
      FROM unnest($1::float[], $2::float[]) WITH ORDINALITY AS t(lng, lat, ord)
    ),
    pts_g AS (
      SELECT idx, ST_SetSRID(ST_Point(lng, lat), 4326) AS g,
             ST_Buffer(ST_SetSRID(ST_Point(lng, lat), 4326)::geography, ${infraSearchRadius})::geometry AS buf
      FROM pts
    )
    SELECT p.idx,
      COALESCE(agg.cnt, 0)::int AS total_water_count,
      COALESCE(agg.area, 0) AS water_area_sq_m
    FROM pts_g p
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt, SUM(ST_Area(ST_Intersection(w.geom, p.buf)::geography)) AS area
      FROM (
        SELECT geom FROM waterbodies
        UNION ALL SELECT geom FROM lakes
        UNION ALL SELECT geom FROM rivers
        UNION ALL SELECT geom FROM river_areas
        UNION ALL SELECT geom FROM streams
      ) w
      WHERE w.geom && p.buf
    ) agg ON true
    ORDER BY p.idx
  `;

  const emptyInfra = points.map((_, i) => ({ idx: i + 1, total_building_count: 0, building_area_sq_m: 0 }));
  const emptyRoad = points.map((_, i) => ({ idx: i + 1, total_road_count: 0, road_length_m: 0 }));
  const emptyWater = points.map((_, i) => ({ idx: i + 1, total_water_count: 0, water_area_sq_m: 0 }));

  const rasterArgs = [lngs, lats, minLng, minLat, maxLng, maxLat];
  const vectorArgs = [lngs, lats];

  // Cache which optional vector tables actually exist (checked once per process).
  // Skipping dead queries saves ~120ms/batch of wasted round-trips to fail.
  const have = await getVectorTableAvailability();

  const tasks = [
    timedQuery('nlcd', nlcdSql, rasterArgs),
    timedQuery('slope', slopeSql, rasterArgs),
    timedQuery('pop', popSql, rasterArgs),
    timedQuery('sub', subSql, vectorArgs),
    have.buildings ? safeBulk('bld', buildingSql, vectorArgs, emptyInfra) : Promise.resolve(emptyInfra),
    have.roads ? safeBulk('road', roadSql, vectorArgs, emptyRoad) : Promise.resolve(emptyRoad),
    have.water ? safeBulk('water', waterSql, vectorArgs, emptyWater) : Promise.resolve(emptyWater),
  ];

  const t0 = Date.now();
  const [nlcdRows, slopeRows, popRows, subRows, buildingRows, roadRows, waterRows] = await Promise.all(tasks);
  if (LOG_TIMING) console.log(`[grabber] batch_total ${Date.now() - t0}ms points=${points.length}`);

  // Zip results by index.
  const byIdx = (rows) => {
    const m = new Map();
    for (const r of rows) m.set(Number(r.idx), r);
    return m;
  };
  const nlcdMap = byIdx(nlcdRows);
  const slopeMap = byIdx(slopeRows);
  const popMap = byIdx(popRows);
  const subMap = byIdx(subRows);
  const buildingMap = byIdx(buildingRows);
  const roadMap = byIdx(roadRows);
  const waterMap = byIdx(waterRows);

  const filtered = [];
  let nullNlcd = 0, nullSlope = 0, nullPop = 0, nullSub = 0;
  for (let i = 0; i < points.length; i++) {
    const idx = i + 1;
    const lng = lngs[i];
    const lat = lats[i];
    const n = nlcdMap.get(idx);
    const s = slopeMap.get(idx);
    const po = popMap.get(idx);
    const sb = subMap.get(idx);
    const bd = buildingMap.get(idx) || { total_building_count: 0, building_area_sq_m: 0 };
    const rd = roadMap.get(idx) || { total_road_count: 0, road_length_m: 0 };
    const wt = waterMap.get(idx) || { total_water_count: 0, water_area_sq_m: 0 };

    // Gating values: NLCD (classification required) and substation distance (transmission required)
    if (!Number.isFinite(n?.nlcd_value)) {
      if (skipNulls) { nullNlcd++; continue; }
      throw new Error(`NLCD value lookup failed for point (${lng}, ${lat})`);
    }
    if (!Number.isFinite(sb?.sub_distance)) {
      if (skipNulls) { nullSub++; continue; }
      throw new Error(`Substation distance lookup failed for point (${lng}, ${lat})`);
    }
    // Optional values: null → 0 fallback (slope=flat, pop=uninhabited)
    const slopeVal = Number.isFinite(s?.slope_elevation) ? s.slope_elevation : 0;
    const popVal = Number.isFinite(po?.population_density) ? po.population_density : 0;
    if (!Number.isFinite(s?.slope_elevation)) nullSlope++;
    if (!Number.isFinite(po?.population_density)) nullPop++;

    const roadPresent = (rd.total_road_count || 0) > 0 || (rd.road_length_m || 0) > 0;
    const waterPresent = (wt.total_water_count || 0) > 0 || (wt.water_area_sq_m || 0) > 0;
    const hasInfrastructureOrWater =
      (bd.total_building_count || 0) > 0 ||
      (bd.building_area_sq_m || 0) > 0 ||
      roadPresent ||
      waterPresent;

    filtered.push({
      lng,
      lat,
      nlcd_value: n.nlcd_value,
      nlcd_lng: lng,
      nlcd_lat: lat,
      slope_elevation: slopeVal,
      slope_lng: lng,
      slope_lat: lat,
      population_density: popVal,
      pop_lng: lng,
      pop_lat: lat,
      sub_lng: sb.sub_lng,
      sub_lat: sb.sub_lat,
      sub_distance: sb.sub_distance,
      infra_or_water: hasInfrastructureOrWater ? 1 : 0,
      road_present: roadPresent ? 1 : 0,
      water_present: waterPresent ? 1 : 0,
    });
  }

  if (LOG_TIMING) {
    console.log(`[grabber] kept=${filtered.length}/${points.length} nulls: nlcd=${nullNlcd} slope=${nullSlope} pop=${nullPop} sub=${nullSub}`);
  }

  if (filtered.length > 0) {
    addBatchData(filtered);
  }

  return filtered;
}

async function querySolarDataForPoint(lng, lat) {
  const results = await querySolarDataForPoints([[lng, lat]]);
  return results[0];
}

module.exports = {
  querySolarDataForPoints,
  querySolarDataForPoint,
};
