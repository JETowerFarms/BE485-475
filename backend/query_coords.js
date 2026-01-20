const pgp = require('pg-promise')();
const dotenv = require('dotenv');

dotenv.config();

// Database connection configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'michigan_solar',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD
};

const db = pgp(dbConfig);

const coordinates = [
  [42.66988, -83.371120],
  [42.670101, -83.369972],
  [42.668736, -83.370723],
  [42.669139, -83.369221]
];

async function queryData() {
  try {
    console.log('Connected to database');

    for (let i = 0; i < coordinates.length; i++) {
      const [lat, lng] = coordinates[i];
      console.log(`\n=== Point ${i + 1}: (${lat}, ${lng}) ===`);

      // Query landcover
      try {
        const landcover = await db.oneOrNone(`
          SELECT ST_Value(rast, ST_Transform(ST_SetSRID(ST_MakePoint($2, $1), 4326), 5070)) as nlcd_val
          FROM landcover_nlcd_2024_raster r
          WHERE ST_Intersects(r.rast, ST_Transform(ST_SetSRID(ST_MakePoint($2, $1), 4326), 5070))
          LIMIT 1
        `, [lat, lng]);
        console.log('Landcover NLCD:', landcover?.nlcd_val ?? 'NULL');
      } catch (e) {
        console.log('Landcover NLCD: ERROR -', e.message);
      }

      // Query slope
      try {
        const slope = await db.oneOrNone(`
          SELECT ST_Value(rast, ST_Transform(ST_SetSRID(ST_MakePoint($2, $1), 4326), 5070)) as slope_val
          FROM slope_raster r
          WHERE ST_Intersects(r.rast, ST_Transform(ST_SetSRID(ST_MakePoint($2, $1), 4326), 5070))
          LIMIT 1
        `, [lat, lng]);
        console.log('Slope (degrees):', slope?.slope_val ?? 'NULL');
      } catch (e) {
        console.log('Slope: ERROR -', e.message);
      }

      // Query population
      try {
        const pop = await db.oneOrNone(`
          SELECT ST_Value(rast, ST_SetSRID(ST_MakePoint($2, $1), 4326)) as pop_val
          FROM population_raster r
          WHERE ST_Intersects(rast, ST_SetSRID(ST_MakePoint($2, $1), 4326))
          LIMIT 1
        `, [lat, lng]);
        console.log('Population density:', pop?.pop_val ?? 'NULL');
      } catch (e) {
        console.log('Population: ERROR -', e.message);
      }

      // Query transmission distance
      try {
        const dist = await db.oneOrNone(`
          SELECT ST_Distance(ST_Transform(s.geom, 5070), ST_Transform(ST_SetSRID(ST_MakePoint($2, $1), 4326), 5070)) as dist_meters
          FROM substations s
          ORDER BY ST_Transform(s.geom, 5070) <-> ST_Transform(ST_SetSRID(ST_MakePoint($2, $1), 4326), 5070)
          LIMIT 1
        `, [lat, lng]);
        console.log('Transmission distance (meters):', dist?.dist_meters ?? 'NULL');
      } catch (e) {
        console.log('Transmission distance: ERROR -', e.message);
      }
    }

  } catch (error) {
    console.error('Database error:', error);
  } finally {
    pgp.end();
  }
}

queryData();