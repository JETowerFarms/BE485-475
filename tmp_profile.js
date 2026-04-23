// Profiler: run each of the 7 bulk queries separately + all concurrently,
// measuring wall-clock time, to identify the real bottleneck.
process.chdir('/home/money/backend');
require('/home/money/backend/node_modules/dotenv').config({ path: '/home/money/backend/.env' });
const { db } = require('/home/money/backend/src/database');

// Synthetic 100 points around farm 8 centroid (approx Michigan).
async function genPoints() {
  const farm = await db.one("SELECT ST_X(ST_Centroid(boundary::geometry))::float AS lng, ST_Y(ST_Centroid(boundary::geometry))::float AS lat FROM farms WHERE id IN (SELECT id FROM farms ORDER BY id LIMIT 1 OFFSET 1)");
  const pts = [];
  for (let i = 0; i < 100; i++) {
    pts.push([farm.lng + (Math.random() - 0.5) * 0.02, farm.lat + (Math.random() - 0.5) * 0.02]);
  }
  return pts;
}

const infraSearchRadius = 2500;

function queries() {
  return {
    nlcd: `WITH pts AS (SELECT ord AS idx, lng, lat FROM unnest($1::float[], $2::float[]) WITH ORDINALITY AS t(lng,lat,ord))
      SELECT p.idx, r.v FROM pts p
      LEFT JOIN LATERAL (
        SELECT ST_Value(rast, ST_Transform(ST_SetSRID(ST_Point(p.lng,p.lat),4326), ST_SRID(rast))) AS v
        FROM landcover_nlcd_2024_raster
        WHERE ST_Intersects(rast, ST_Transform(ST_SetSRID(ST_Point(p.lng,p.lat),4326), ST_SRID(rast)))
        LIMIT 1
      ) r ON true ORDER BY p.idx`,
    slope: `WITH pts AS (SELECT ord AS idx, lng, lat FROM unnest($1::float[], $2::float[]) WITH ORDINALITY AS t(lng,lat,ord))
      SELECT p.idx, r.v FROM pts p
      LEFT JOIN LATERAL (
        SELECT ST_Value(rast, ST_Transform(ST_SetSRID(ST_Point(p.lng,p.lat),4326), ST_SRID(rast))) AS v
        FROM slope_raster
        WHERE ST_Intersects(rast, ST_Transform(ST_SetSRID(ST_Point(p.lng,p.lat),4326), ST_SRID(rast)))
        LIMIT 1
      ) r ON true ORDER BY p.idx`,
    pop: `WITH pts AS (SELECT ord AS idx, lng, lat FROM unnest($1::float[], $2::float[]) WITH ORDINALITY AS t(lng,lat,ord))
      SELECT p.idx, r.v FROM pts p
      LEFT JOIN LATERAL (
        SELECT ST_Value(rast, ST_Transform(ST_SetSRID(ST_Point(p.lng,p.lat),4326), ST_SRID(rast))) AS v
        FROM population_raster
        WHERE ST_Intersects(rast, ST_Transform(ST_SetSRID(ST_Point(p.lng,p.lat),4326), ST_SRID(rast)))
        LIMIT 1
      ) r ON true ORDER BY p.idx`,
    sub: `WITH pts AS (SELECT ord AS idx, lng, lat FROM unnest($1::float[], $2::float[]) WITH ORDINALITY AS t(lng,lat,ord))
      SELECT p.idx, s.distance FROM pts p
      LEFT JOIN LATERAL (
        SELECT ST_Distance(geom, ST_SetSRID(ST_Point(p.lng,p.lat),4326)) AS distance
        FROM substations ORDER BY geom <-> ST_SetSRID(ST_Point(p.lng,p.lat),4326) LIMIT 1
      ) s ON true ORDER BY p.idx`,
  };
}

async function timed(label, fn) {
  const t = Date.now();
  try {
    const r = await fn();
    console.log(`${label}\t${Date.now() - t}ms\t${Array.isArray(r) ? r.length : '?'}rows`);
    return r;
  } catch (e) {
    console.log(`${label}\tERR ${Date.now() - t}ms\t${e.message}`);
    return null;
  }
}

(async () => {
  try {
    const points = await genPoints();
    const lngs = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    const q = queries();
    const args = [lngs, lats];

    console.log('\n=== INDIVIDUAL (each query alone) ===');
    for (const [name, sql] of Object.entries(q)) {
      await timed(name, () => db.any(sql, args));
    }

    console.log('\n=== INDIVIDUAL AGAIN (cached) ===');
    for (const [name, sql] of Object.entries(q)) {
      await timed(name, () => db.any(sql, args));
    }

    console.log('\n=== ALL CONCURRENT (7 Promise.all) ===');
    const tAll = Date.now();
    await Promise.all(Object.entries(q).map(([n, sql]) => db.any(sql, args)));
    console.log(`concurrent\t${Date.now() - tAll}ms`);

    console.log('\n=== SEQUENTIAL SUM (for comparison) ===');
    const tSeq = Date.now();
    for (const [n, sql] of Object.entries(q)) await db.any(sql, args);
    console.log(`sequential\t${Date.now() - tSeq}ms`);

    // DB-side raster info
    console.log('\n=== DB META ===');
    const meta = await db.any(`
      SELECT 'nlcd' AS t, COUNT(*)::int AS tiles, pg_size_pretty(pg_total_relation_size('landcover_nlcd_2024_raster')) AS size FROM landcover_nlcd_2024_raster
      UNION ALL SELECT 'slope', COUNT(*)::int, pg_size_pretty(pg_total_relation_size('slope_raster')) FROM slope_raster
      UNION ALL SELECT 'pop', COUNT(*)::int, pg_size_pretty(pg_total_relation_size('population_raster')) FROM population_raster
      UNION ALL SELECT 'substations', COUNT(*)::int, pg_size_pretty(pg_total_relation_size('substations')) FROM substations
    `);
    for (const r of meta) console.log(JSON.stringify(r));

    // Postgres settings snapshot
    const settings = await db.any(`SELECT name, setting, unit FROM pg_settings WHERE name IN ('shared_buffers','work_mem','effective_cache_size','max_connections','random_page_cost','seq_page_cost')`);
    console.log('\n=== DB SETTINGS ===');
    for (const r of settings) console.log(`${r.name}\t${r.setting}${r.unit || ''}`);

    process.exit(0);
  } catch (e) {
    console.error('FATAL', e.message, e.stack);
    process.exit(1);
  }
})();
