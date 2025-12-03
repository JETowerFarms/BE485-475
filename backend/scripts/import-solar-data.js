const fs = require('fs');
const readline = require('readline');
const pgp = require('pg-promise')();
const dotenv = require('dotenv');

dotenv.config();

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'michigan_solar',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 20,
};

const db = pgp(dbConfig);

// Configuration
const SOLAR_DATA_FILE = '../src/data/michiganSolarSuitability_30x30.json';
const BATCH_SIZE = 10000; // Insert 10k records at a time
const PROGRESS_INTERVAL = 50000; // Show progress every 50k records

async function importSolarData() {
  console.log('='.repeat(60));
  console.log('Michigan Solar Data Import Script');
  console.log('='.repeat(60));
  console.log('');

  // Check if file exists
  if (!fs.existsSync(SOLAR_DATA_FILE)) {
    console.error(`❌ Error: File not found: ${SOLAR_DATA_FILE}`);
    console.log('Please ensure the 30x30 grid data file exists.');
    process.exit(1);
  }

  const stats = fs.statSync(SOLAR_DATA_FILE);
  console.log(`📁 File: ${SOLAR_DATA_FILE}`);
  console.log(`📊 Size: ${(stats.size / (1024 * 1024 * 1024)).toFixed(2)} GB`);
  console.log('');

  try {
    // Test database connection
    await db.one('SELECT NOW()');
    console.log('✓ Database connection successful');
    console.log('');

    // Create insert statement generator
    const cs = new pgp.helpers.ColumnSet(
      [
        'lat',
        'lng',
        { name: 'location', mod: ':raw' },
        { name: 'overall_score', prop: 'overall' },
        { name: 'land_cover_score', prop: 'land_cover' },
        { name: 'slope_score', prop: 'slope' },
        { name: 'transmission_score', prop: 'transmission' },
        { name: 'population_score', prop: 'population' },
      ],
      { table: 'solar_suitability' }
    );

    let batch = [];
    let totalRecords = 0;
    let startTime = Date.now();

    console.log('📥 Starting import...\n');

    // Read and parse JSON file line by line (streaming)
    const fileStream = fs.createReadStream(SOLAR_DATA_FILE, { encoding: 'utf8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let currentLat = null;
    let jsonBuffer = '';
    let inDataSection = false;

    for await (const line of rl) {
      const trimmed = line.trim();

      // Skip opening brace
      if (trimmed === '{') {
        inDataSection = true;
        continue;
      }

      // Skip closing brace
      if (trimmed === '}') {
        break;
      }

      // Parse latitude key
      if (trimmed.startsWith('"') && trimmed.includes('": {')) {
        currentLat = parseFloat(trimmed.split('"')[1]);
        continue;
      }

      // Parse longitude data
      if (currentLat !== null && trimmed.startsWith('"') && trimmed.includes('": {')) {
        const lngMatch = trimmed.match(/"([^"]+)": ({[^}]+})/);
        if (lngMatch) {
          const lng = parseFloat(lngMatch[1]);
          const dataStr = lngMatch[2].replace(/,$/, '');

          try {
            const data = JSON.parse(dataStr);

            // Add to batch with PostGIS point
            batch.push({
              lat: currentLat,
              lng: lng,
              location: `ST_MakePoint(${lng}, ${currentLat})::geography`,
              overall: data.overall || null,
              land_cover: data.land_cover || null,
              slope: data.slope || null,
              transmission: data.transmission || null,
              population: data.population || null,
            });

            totalRecords++;

            // Insert batch when it reaches BATCH_SIZE
            if (batch.length >= BATCH_SIZE) {
              const insert = pgp.helpers.insert(batch, cs);
              await db.none(insert);

              batch = [];

              // Show progress
              if (totalRecords % PROGRESS_INTERVAL === 0) {
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                const rate = Math.round(totalRecords / elapsed);
                console.log(
                  `  ✓ Imported ${totalRecords.toLocaleString()} records (${rate.toLocaleString()}/sec)`
                );
              }
            }
          } catch (parseError) {
            console.warn(`Warning: Failed to parse data at ${currentLat}, ${lng}`);
          }
        }
      }
    }

    // Insert remaining batch
    if (batch.length > 0) {
      const insert = pgp.helpers.insert(batch, cs);
      await db.none(insert);
      console.log(`  ✓ Imported final batch of ${batch.length.toLocaleString()} records`);
    }

    const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const avgRate = Math.round(totalRecords / ((Date.now() - startTime) / 1000));

    console.log('');
    console.log('='.repeat(60));
    console.log('✅ Import Complete!');
    console.log('='.repeat(60));
    console.log(`📊 Total records imported: ${totalRecords.toLocaleString()}`);
    console.log(`⏱️  Total time: ${totalTime} minutes`);
    console.log(`⚡ Average rate: ${avgRate.toLocaleString()} records/second`);
    console.log('');

    // Verify import
    const count = await db.one('SELECT COUNT(*) FROM solar_suitability');
    console.log(`✓ Database verification: ${parseInt(count.count).toLocaleString()} records`);

    // Show sample data
    console.log('\n📋 Sample data:');
    const sample = await db.any('SELECT * FROM solar_suitability LIMIT 3');
    sample.forEach((row, i) => {
      console.log(`  ${i + 1}. Lat: ${row.lat}, Lng: ${row.lng}, Overall: ${row.overall_score}`);
    });

    console.log('');
  } catch (error) {
    console.error('\n❌ Import failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await db.$pool.end();
  }
}

// Run import
importSolarData();
