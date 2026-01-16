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

async function ensureTable() {
  console.log('Ensuring solar_suitability table exists...');
  try {
    await db.none(`
      CREATE TABLE IF NOT EXISTS solar_suitability (
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        overall_score DOUBLE PRECISION,
        land_cover_score DOUBLE PRECISION,
        slope_score DOUBLE PRECISION,
        transmission_score DOUBLE PRECISION,
        population_score DOUBLE PRECISION,
        PRIMARY KEY (lat, lng)
      );
      CREATE INDEX IF NOT EXISTS idx_solar_suitability_overall ON solar_suitability (overall_score);
      CREATE INDEX IF NOT EXISTS idx_solar_suitability_location ON solar_suitability (lat, lng);
    `);
    console.log('✓ Table ready');
  } catch (error) {
    console.error('❌ Failed:', error.message);
    throw error;
  } finally {
    await db.$pool.end();
  }
}

ensureTable();
