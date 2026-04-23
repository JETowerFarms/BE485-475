#!/bin/bash
sudo -u money bash -c 'cd /home/money/backend && node' <<'EOF'
const {db}=require("./src/database");
(async()=>{
  // Check if farm 11 has ANY row in farm_analysis (regardless of total_points)
  const row = await db.oneOrNone("SELECT farm_id, total_points, avg_overall, analysis_data IS NOT NULL AS has_data, jsonb_typeof(analysis_data) AS dtype, length(analysis_data::text) AS dsize, created_at FROM farm_analysis WHERE farm_id=11");
  console.log("farm 11 row:", row);
  const all = await db.any("SELECT farm_id, total_points, length(analysis_data::text) AS sz FROM farm_analysis ORDER BY farm_id");
  console.log("all farm_analysis rows:");
  console.table(all);
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1)});
EOF
