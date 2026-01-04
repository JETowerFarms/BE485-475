const dotenv = require('dotenv');
const { testConnection, queries } = require('../src/database');
const { getOrCreatePricingSnapshot } = require('../src/pricing');

dotenv.config();

async function main() {
  const ok = await testConnection();
  if (!ok) {
    process.exitCode = 2;
    return;
  }

  try {
    const result = await getOrCreatePricingSnapshot(queries, { forceRefresh: true });
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('Failed to refresh pricing snapshot:', e.message);
    if (e.details) console.error('Details:', e.details);
    process.exitCode = 1;
  }
}

main();
