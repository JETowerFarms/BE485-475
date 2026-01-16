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

async function dropOldTables() {
  console.log('Dropping old tables with PostGIS columns...');
  try {
    await db.none('DROP TABLE IF EXISTS energy_substations CASCADE');
    console.log('✓ Dropped energy_substations');
  } catch (error) {
    console.error('❌ Failed:', error.message);
    throw error;
  } finally {
    await db.$pool.end();
  }
}

dropOldTables();
