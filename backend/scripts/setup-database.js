const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

async function setupDatabase() {
  console.log('='.repeat(60));
  console.log('Michigan Solar Database Setup');
  console.log('='.repeat(60));
  console.log('');

  // First connect without database to create it
  const adminClient = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    database: 'postgres', // Connect to default database
  });

  try {
    await adminClient.connect();
    console.log('✓ Connected to PostgreSQL');

    // Check if database exists
    const dbName = process.env.DB_NAME || 'michigan_solar';
    const dbExists = await adminClient.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbName]
    );

    if (dbExists.rowCount === 0) {
      console.log(`\n📦 Creating database: ${dbName}`);
      await adminClient.query(`CREATE DATABASE ${dbName}`);
      console.log('✓ Database created');
    } else {
      console.log(`\n✓ Database '${dbName}' already exists`);
    }

    await adminClient.end();

    // Connect to the new database
    const client = new Client({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      database: dbName,
    });

    await client.connect();
    console.log(`✓ Connected to database: ${dbName}`);

    // Enable PostGIS extension
    console.log('\n🗺️  Enabling PostGIS extension...');
    await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
    console.log('✓ PostGIS extension enabled');

    // Run schema SQL file
    console.log('\n📄 Executing schema SQL...');
    const schemaPath = path.join(__dirname, '..', 'DATABASE_SCHEMA.sql');

    if (!fs.existsSync(schemaPath)) {
      console.error(`❌ Schema file not found: ${schemaPath}`);
      process.exit(1);
    }

    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    // Split by statement (simple approach - may need refinement for complex SQL)
    const statements = schemaSql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      try {
        await client.query(statement);
      } catch (err) {
        // Ignore "already exists" errors
        if (!err.message.includes('already exists')) {
          console.warn(`Warning: ${err.message}`);
        }
      }
    }

    console.log('✓ Schema created successfully');

    // Verify tables
    console.log('\n📊 Verifying tables...');
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);

    console.log(`✓ Found ${tables.rowCount} tables:`);
    tables.rows.forEach((row) => {
      console.log(`  - ${row.table_name}`);
    });

    // Verify PostGIS functions
    console.log('\n🔧 Verifying PostGIS functions...');
    const functions = await client.query(`
      SELECT routine_name 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
        AND routine_type = 'FUNCTION'
        AND routine_name LIKE 'get_%'
      ORDER BY routine_name
    `);

    console.log(`✓ Found ${functions.rowCount} custom functions:`);
    functions.rows.forEach((row) => {
      console.log(`  - ${row.routine_name}`);
    });

    await client.end();

    console.log('\n' + '='.repeat(60));
    console.log('✅ Database setup complete!');
    console.log('='.repeat(60));
    console.log('\nNext steps:');
    console.log('1. Start the API server: npm run dev');
    console.log('');
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

setupDatabase();
