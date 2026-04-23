#!/bin/bash
sudo -u money bash -c 'cd /home/money/backend && node' <<'EOF'
const {db}=require("./src/database");
(async()=>{
  for (const fid of [11, 12, 13, 89, 90, 92, 93, 94, 95, 96, 97]) {
    const f = await db.oneOrNone("SELECT id, name, ST_AsGeoJSON(boundary) AS g, ST_Area(boundary::geography)/4046.8564224 AS acres FROM farms WHERE id=$1", [fid]);
    if (!f) { console.log(fid, "missing"); continue; }
    const g = JSON.parse(f.g);
    const ring = g.coordinates?.[0] || [];
    console.log(`farm ${f.id} (${f.name}): pgArea=${Number(f.acres).toFixed(1)} acres, boundary points=${ring.length}, first pt=${ring[0]?.join(",")}`);
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1)});
EOF
