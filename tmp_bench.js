// Benchmark OLD vs NEW grabber SQL. Worker must be stopped first.
process.chdir('/home/money/backend');
require('/home/money/backend/node_modules/dotenv').config({ path: '/home/money/backend/.env' });
const { db } = require('/home/money/backend/src/database');

async function genPoints() {
  const farm = await db.one("SELECT ST_X(ST_Centroid(boundary::geometry))::float AS lng, ST_Y(ST_Centroid(boundary::geometry))::float AS lat, ST_XMin(boundary::geometry)::float AS xmin, ST_YMin(boundary::geometry)::float AS ymin, ST_XMax(boundary::geometry)::float AS xmax, ST_YMax(boundary::geometry)::float AS ymax FROM farms WHERE id = (SELECT f.id FROM farms f LEFT JOIN farm_analysis fa ON fa.farm_id=f.id WHERE fa.farm_id IS NULL ORDER BY f.id LIMIT 1)");
  console.log('Farm bbox:', farm);
  const pts = [];
  for (let i = 0; i < 100; i++) {
    pts.push([
      farm.xmin + Math.random() * (farm.xmax - farm.xmin),
      farm.ymin + Math.random() * (farm.ymax - farm.ymin),
    ]);
  }
  return pts;
}

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

const OLD_NLCD = `
  WITH pts AS (SELECT ord AS idx, lng, lat FROM unnest($1::float[], $2::float[]) WITH ORDINALITY AS t(lng,lat,ord))
  SELECT p.idx, r.v FROM pts p
  LEFT JOIN LATERAL (
    SELECT ST_Value(rast, ST_Transform(ST_SetSRID(ST_Point(p.lng,p.lat),4326), ST_SRID(rast))) AS v
    FROM landcover_nlcd_2024_raster
    WHERE ST_Intersects(rast, ST_Transform(ST_SetSRID(ST_Point(p.lng,p.lat),4326), ST_SRID(rast)))
    LIMIT 1
  ) r ON true ORDER BY p.idx`;

const NEW_NLCD = `
  WITH bbox AS (SELECT ST_MakeEnvelope($3,$4,$5,$6,4326) AS g),
  clipped AS MATERIALIZED (
    SELECT ST_Union(ST_Clip(r.rast, ST_Transform(b.g, ST_SRID(r.rast)), true)) AS rast
    FROM landcover_nlcd_2024_raster r, bbox b
    WHERE r.rast && ST_Transform(b.g, ST_SRID(r.rast))
  ),
  pts AS (SELECT ord AS idx, lng, lat FROM unnest($1::float[], $2::float[]) WITH ORDINALITY AS t(lng,lat,ord))
  SELECT p.idx, ST_Value(c.rast, ST_Transform(ST_SetSRID(ST_Point(p.lng,p.lat),4326), ST_SRID(c.rast))) AS v
  FROM pts p CROSS JOIN clipped c ORDER BY p.idx`;

const OLD_SLOPE = OLD_NLCD.replace(/landcover_nlcd_2024_raster/g, 'slope_raster');
const NEW_SLOPE = NEW_NLCD.replace(/landcover_nlcd_2024_raster/g, 'slope_raster');

async function timed(label, sql, args) {
  const t = Date.now();
  try {
    const r = await db.any(sql, args);
    const nonNull = r.filter((x) => x.v != null).length;
    console.log(`${label}\t${Date.now() - t}ms\tnonNull=${nonNull}/${r.length}`);
    return r;
  } catch (e) {
    console.log(`${label}\tERR ${Date.now() - t}ms\t${e.message}`);
  }
}

(async () => {
  const points = await genPoints();
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const [minLng, minLat, maxLng, maxLat] = bbox(points);
  const vArgs = [lngs, lats];
  const rArgs = [lngs, lats, minLng, minLat, maxLng, maxLat];

  console.log('\n=== RUN 1 (cold) ===');
  await timed('OLD_NLCD', OLD_NLCD, vArgs);
  await timed('NEW_NLCD', NEW_NLCD, rArgs);
  await timed('OLD_SLOPE', OLD_SLOPE, vArgs);
  await timed('NEW_SLOPE', NEW_SLOPE, rArgs);

  console.log('\n=== RUN 2 (warm) ===');
  await timed('OLD_NLCD', OLD_NLCD, vArgs);
  await timed('NEW_NLCD', NEW_NLCD, rArgs);
  await timed('OLD_SLOPE', OLD_SLOPE, vArgs);
  await timed('NEW_SLOPE', NEW_SLOPE, rArgs);

  console.log('\n=== PARALLEL BOTH NEW (nlcd+slope+pop together) ===');
  const t = Date.now();
  await Promise.all([
    db.any(NEW_NLCD, rArgs),
    db.any(NEW_SLOPE, rArgs),
    db.any(NEW_NLCD.replace(/landcover_nlcd_2024_raster/g, 'population_raster').replace(/\bnlcd_\w+\b/g, ''), rArgs),
  ]);
  console.log(`parallel 3 rasters: ${Date.now() - t}ms`);

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
