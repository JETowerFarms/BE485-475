process.chdir('/home/money/backend');
require('/home/money/backend/node_modules/dotenv').config({ path: '/home/money/backend/.env' });
const { db } = require('/home/money/backend/src/database');
(async () => {
  const id = Number(process.argv[2] || 8);
  const keys = await db.any(`SELECT jsonb_object_keys(analysis_data->'solarSuitability') AS k FROM farm_analysis WHERE farm_id=$1`, [id]);
  console.log(`farm=${id} solarSuitability keys: ${keys.map(x => x.k).join(',')}`);
  const counts = await db.one(`
    SELECT jsonb_array_length(COALESCE(analysis_data->'solarSuitability'->'points', '[]'::jsonb)) AS ss_pts,
           analysis_data->'metadata'->>'totalPoints' AS meta_tp,
           analysis_data->>'success' AS success,
           total_points, avg_overall
    FROM farm_analysis WHERE farm_id=$1
  `, [id]);
  console.log(JSON.stringify(counts));
  process.exit(0);
})();
