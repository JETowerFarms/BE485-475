const fs = require('fs/promises');
const path = require('path');
const pgp = require('pg-promise')();
const dotenv = require('dotenv');

dotenv.config();

const SOLAR_DATA_PATH = process.env.SOLAR_DATA_PATH || path.resolve(__dirname, '../data/solar_chunks');
const BATCH_SIZE = parseInt(process.env.SOLAR_IMPORT_BATCH || '10000', 10);
const PROGRESS_INTERVAL = parseInt(process.env.SOLAR_IMPORT_PROGRESS || '50000', 10);

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.DB_NAME || 'michigan_solar',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: parseInt(process.env.DB_MAX_CONNECTIONS, 10) || 20,
};

const db = pgp(dbConfig);

const columnSet = new pgp.helpers.ColumnSet(
  [
    'lat',
    'lng',
    { name: 'overall_score', prop: 'overall' },
    { name: 'land_cover_score', prop: 'land_cover' },
    { name: 'slope_score', prop: 'slope' },
    { name: 'transmission_score', prop: 'transmission' },
    { name: 'population_score', prop: 'population' },
  ],
  { table: 'solar_suitability' }
);

async function listChunkFiles(targetPath) {
  const stats = await fs.stat(targetPath);
  if (stats.isDirectory()) {
    const entries = await fs.readdir(targetPath);
    return entries
      .filter((entry) => entry.endsWith('.json'))
      .filter((entry) => entry !== 'manifest.json')
      .map((entry) => path.join(targetPath, entry))
      .sort();
  }
  return [targetPath];
}



async function insertBatch(rows, counters) {
  if (!rows.length) {
    return;
  }
  const insert = pgp.helpers.insert(rows, columnSet);
  await db.none(insert);
  counters.total += rows.length;
  rows.length = 0;
  if (counters.total % PROGRESS_INTERVAL === 0) {
    console.log(`  ✓ Imported ${counters.total.toLocaleString()} records`);
  }
}

async function importChunk(filePath, counters) {
  const raw = await fs.readFile(filePath, 'utf8');
  const chunk = JSON.parse(raw);
  const rows = [];

  for (const [latKey, lngMap] of Object.entries(chunk)) {
    const lat = parseFloat(latKey);
    if (!Number.isFinite(lat)) {
      continue;
    }

    for (const [lngKey, data] of Object.entries(lngMap)) {
      const lng = parseFloat(lngKey);
      if (!Number.isFinite(lng)) {
        continue;
      }

      rows.push({
        lat,
        lng,
        overall: data.overall ?? null,
        land_cover: data.land_cover ?? null,
        slope: data.slope ?? null,
        transmission: data.transmission ?? null,
        population: data.population ?? null,
      });

      if (rows.length >= BATCH_SIZE) {
        await insertBatch(rows, counters);
      }
    }
  }

  await insertBatch(rows, counters);
}

async function importSolarData() {
  console.log('='.repeat(70));
  console.log('Michigan Solar Data Import');
  console.log('='.repeat(70));
  console.log('Source:', SOLAR_DATA_PATH);
  console.log('');

  await db.one('SELECT NOW()');
  console.log('✓ Database connection successful');

  const files = await listChunkFiles(SOLAR_DATA_PATH);
  if (files.length === 0) {
    throw new Error('No chunk files found to import.');
  }

  console.log(`Found ${files.length} chunk file(s). Truncating solar_suitability...`);
  await db.none('TRUNCATE solar_suitability');

  const counters = { total: 0 };
  for (const file of files) {
    console.log(`→ Importing ${path.basename(file)} ...`);
    await importChunk(file, counters);
  }

  console.log('\n='.repeat(35));
  console.log(`✅ Import finished. Rows inserted: ${counters.total.toLocaleString()}`);

  const count = await db.one('SELECT COUNT(*) FROM solar_suitability');
  console.log(`Database row count: ${parseInt(count.count, 10).toLocaleString()}`);

  const sample = await db.any('SELECT * FROM solar_suitability ORDER BY lat ASC, lng ASC LIMIT 3');
  console.log('\nSample rows:');
  sample.forEach((row, idx) => {
    console.log(
      `  ${idx + 1}. lat=${row.lat} lng=${row.lng} overall=${row.overall_score}`
    );
  });
}

importSolarData()
  .then(async () => {
    await db.$pool.end();
  })
  .catch(async (error) => {
    console.error('\n❌ Import failed:', error.message);
    console.error(error);
    await db.$pool.end();
    process.exit(1);
  });
