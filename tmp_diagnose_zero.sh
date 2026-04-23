#!/bin/bash
FARM_ID="${1:-8}"
sudo -u money FARM_ID="$FARM_ID" bash -c 'cd /home/money/backend && node' <<'EOF'
const { db } = require("./src/database");
const { querySolarDataForPoints } = require("./src/utils/solarDataGrabber");

(async () => {
  const farmId = Number(process.env.FARM_ID || 8);
  // Get farm boundary, generate a small sample of grid points like reportsHandler does.
  const farm = await db.one("SELECT id, name, ST_AsGeoJSON(boundary) AS geom FROM farms WHERE id=$1", [farmId]);
  console.log("Farm:", farm.id, farm.name);
  const g = JSON.parse(farm.geom);
  const coords = g.coordinates[0];
  const lngs = coords.map(c => c[0]);
  const lats = coords.map(c => c[1]);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  console.log("BBox:", { minLng, minLat, maxLng, maxLat });
  console.log("Span deg:", { lng: (maxLng-minLng).toFixed(4), lat: (maxLat-minLat).toFixed(4) });

  // Sample 100 points across the bbox grid (step by 1/10 each axis)
  const pts = [];
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) {
      const lng = minLng + (maxLng - minLng) * (i + 0.5) / 10;
      const lat = minLat + (maxLat - minLat) * (j + 0.5) / 10;
      pts.push([lng, lat]);
    }
  }
  console.log("Testing", pts.length, "sample points...");
  process.env.GRABBER_TIMING = "1";
  const result = await querySolarDataForPoints(pts, { skipNulls: true });
  console.log("RESULT: filtered length =", result.length, "/", pts.length);
  if (result.length > 0) {
    console.log("Sample:", JSON.stringify(result[0], null, 2));
  } else {
    console.log("ALL SKIPPED. Running raw queries to find which null...");
    const [nlcd, slope, pop, sub] = await Promise.all([
      db.any(`WITH bbox AS (SELECT ST_MakeEnvelope($3,$4,$5,$6,4326) AS g),
              clipped AS MATERIALIZED (
                SELECT ST_Union(ST_Clip(r.rast, ST_Transform(b.g, ST_SRID(r.rast)), true)) AS rast
                FROM landcover_nlcd_2024_raster r, bbox b
                WHERE r.rast && ST_Transform(b.g, ST_SRID(r.rast))
              ),
              pts AS (SELECT ord idx,lng,lat FROM unnest($1::float[], $2::float[]) WITH ORDINALITY AS t(lng,lat,ord))
              SELECT p.idx, ST_Value(c.rast, ST_Transform(ST_SetSRID(ST_Point(p.lng,p.lat),4326), ST_SRID(c.rast))) AS nlcd_value
              FROM pts p CROSS JOIN clipped c ORDER BY p.idx`,
              [pts.map(p=>p[0]), pts.map(p=>p[1]), minLng, minLat, maxLng, maxLat]),
      db.any(`WITH bbox AS (SELECT ST_MakeEnvelope($3,$4,$5,$6,4326) AS g),
              clipped AS MATERIALIZED (
                SELECT ST_Union(ST_Clip(r.rast, ST_Transform(b.g, ST_SRID(r.rast)), true)) AS rast
                FROM slope_raster r, bbox b
                WHERE r.rast && ST_Transform(b.g, ST_SRID(r.rast))
              ),
              pts AS (SELECT ord idx,lng,lat FROM unnest($1::float[], $2::float[]) WITH ORDINALITY AS t(lng,lat,ord))
              SELECT p.idx, ST_Value(c.rast, ST_Transform(ST_SetSRID(ST_Point(p.lng,p.lat),4326), ST_SRID(c.rast))) AS slope_value
              FROM pts p CROSS JOIN clipped c ORDER BY p.idx`,
              [pts.map(p=>p[0]), pts.map(p=>p[1]), minLng, minLat, maxLng, maxLat]),
      db.any(`WITH bbox AS (SELECT ST_MakeEnvelope($3,$4,$5,$6,4326) AS g),
              clipped AS MATERIALIZED (
                SELECT ST_Union(ST_Clip(r.rast, ST_Transform(b.g, ST_SRID(r.rast)), true)) AS rast
                FROM population_raster r, bbox b
                WHERE r.rast && ST_Transform(b.g, ST_SRID(r.rast))
              ),
              pts AS (SELECT ord idx,lng,lat FROM unnest($1::float[], $2::float[]) WITH ORDINALITY AS t(lng,lat,ord))
              SELECT p.idx, ST_Value(c.rast, ST_Transform(ST_SetSRID(ST_Point(p.lng,p.lat),4326), ST_SRID(c.rast))) AS pop_value
              FROM pts p CROSS JOIN clipped c ORDER BY p.idx`,
              [pts.map(p=>p[0]), pts.map(p=>p[1]), minLng, minLat, maxLng, maxLat]),
      db.any(`WITH pts AS (SELECT ord idx,lng,lat FROM unnest($1::float[], $2::float[]) WITH ORDINALITY AS t(lng,lat,ord))
              SELECT p.idx, s.distance FROM pts p LEFT JOIN LATERAL (
                SELECT ST_Distance(geom, ST_SetSRID(ST_Point(p.lng,p.lat),4326)) distance
                FROM substations ORDER BY geom <-> ST_SetSRID(ST_Point(p.lng,p.lat),4326) LIMIT 1
              ) s ON true ORDER BY p.idx`, [pts.map(p=>p[0]), pts.map(p=>p[1])])
    ]);
    const n = (a, k) => ({ total: a.length, nonNull: a.filter(r => r[k] != null && Number.isFinite(Number(r[k]))).length });
    console.log("NLCD:", n(nlcd, "nlcd_value"));
    console.log("SLOPE:", n(slope, "slope_value"));
    console.log("POP:", n(pop, "pop_value"));
    console.log("SUB:", n(sub, "distance"));
    console.log("NLCD sample rows:", nlcd.slice(0,3));
    console.log("SLOPE sample rows:", slope.slice(0,3));
  }
  process.exit(0);
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
EOF
