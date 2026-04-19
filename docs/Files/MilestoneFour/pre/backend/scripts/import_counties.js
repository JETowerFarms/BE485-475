const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'michigan_solar',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

async function importCounties() {
  try {
    const geojsonPath = path.join(__dirname, '../../Datasets/County.geojson');
    const geojsonData = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

    console.log(`Found ${geojsonData.features.length} counties to import`);

    const client = await pool.connect();

    // Clear existing data
    await client.query('DELETE FROM counties');

    // Insert each county
    for (const feature of geojsonData.features) {
      const { properties, geometry } = feature;
      const { OBJECTID, FIPSCode, Name, FIPSNum } = properties;

      // Use FIPSNum as id (unique)
      const countyId = FIPSNum;
      const countyName = Name;
      const fipsCode = FIPSNum;

      // Convert geometry to GeoJSON string
      const geomJson = JSON.stringify(geometry);

      await client.query(`
        INSERT INTO counties (id, name, fips_code, boundary)
        VALUES ($1, $2, $3, ST_GeomFromGeoJSON($4)::geography)
      `, [countyId, countyName, fipsCode, geomJson]);

      console.log(`Imported county: ${countyName} (${fipsCode})`);
    }

    console.log('County import completed successfully');
    client.release();
  } catch (error) {
    console.error('Error importing counties:', error);
  } finally {
    await pool.end();
  }
}

importCounties();