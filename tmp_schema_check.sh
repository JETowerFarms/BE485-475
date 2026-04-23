#!/bin/bash
sudo -u money bash -c 'cd /home/money/backend && node' <<'EOF'
const {db}=require("./src/database");
(async()=>{
  const c=await db.any("SELECT column_name FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position",["farm_analysis"]);
  console.log("farm_analysis cols:", c.map(r=>r.column_name).join(","));
  // Run the worker query directly
  try {
    const r = await db.any(`SELECT f.id, ST_AsGeoJSON(f.boundary)::json AS boundary FROM farms f LEFT JOIN farm_analysis fa ON fa.farm_id = f.id WHERE fa.farm_id IS NULL ORDER BY f.created_at ASC LIMIT 10`);
    console.log("worker query OK:", r.length, "farms");
  } catch(e) { console.error("worker query FAIL:", e.message); }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1)});
EOF
