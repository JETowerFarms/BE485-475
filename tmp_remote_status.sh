#!/bin/bash
sudo -u money bash -c 'cd /home/money/backend && node' <<'EOF'
const {db}=require("./src/database");
(async()=>{
  const a=await db.any("SELECT f.id, f.name, fa.total_points, fa.avg_overall, fa.created_at FROM farms f LEFT JOIN farm_analysis fa ON fa.farm_id=f.id ORDER BY f.id");
  console.table(a);
  const c=await db.one("SELECT COUNT(*) FILTER (WHERE fa.total_points>0) good, COUNT(*) FILTER (WHERE fa.total_points=0) zero, COUNT(*) FILTER (WHERE fa.farm_id IS NULL) missing, COUNT(*) total FROM farms f LEFT JOIN farm_analysis fa ON fa.farm_id=f.id");
  console.log("SUMMARY:", c);
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1)});
EOF
