const pgp = require('pg-promise')();
const dotenv = require('dotenv');

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.DB_NAME || 'michigan_solar',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
};

const db = pgp(dbConfig);

async function setupPostGIS() {
  console.log('Setting up PostGIS extensions...');
  try {
    await db.none('CREATE EXTENSION IF NOT EXISTS postgis');
    console.log('✓ postgis extension enabled');
    
    await db.none('CREATE EXTENSION IF NOT EXISTS postgis_raster');
    console.log('✓ postgis_raster extension enabled');
    
    console.log('\n✅ PostGIS setup complete');
  } catch (error) {
    console.error('❌ PostGIS setup failed:', error.message);
    throw error;
  } finally {
    await db.$pool.end();
  }
}

setupPostGIS();
