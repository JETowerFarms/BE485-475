process.chdir('/home/money/backend');
require('/home/money/backend/node_modules/dotenv').config({ path: '/home/money/backend/.env' });
const { db } = require('/home/money/backend/src/database');
(async () => {
  try {
    const total = await db.one('SELECT COUNT(*)::int AS n FROM farms');
    const done = await db.any('SELECT farm_id, total_points FROM farm_analysis ORDER BY farm_id::int');
    const need = await db.any(`SELECT f.id FROM farms f LEFT JOIN farm_analysis fa ON fa.farm_id=f.id WHERE fa.farm_id IS NULL ORDER BY f.id`);
    console.log(`TOTAL_FARMS=${total.n}`);
    console.log(`ANALYZED=${done.length}: ${done.map(d => `${d.farm_id}(${d.total_points})`).join(', ')}`);
    console.log(`REMAINING=${need.length}: ${need.map(n => n.id).join(', ')}`);
    process.exit(0);
  } catch (e) { console.error(e.message); process.exit(1); }
})();
