const pgp = require('pg-promise')();
const dotenv = require('dotenv');

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'michigan_solar',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
};

const db = pgp(dbConfig);

const coordinates = [
  [42.667543, -83.420198],
  [42.663805, -83.418769],
  [42.667938, -83.416549],
  [42.664105, -83.415476],
];

async function queryData() {
  try {
    console.log('Connected to database');

    const tables = await db.any(
      `
      SELECT t.table_name
      FROM information_schema.tables t
      WHERE t.table_schema = 'public'
        AND t.table_name LIKE 'landcover_%'
      ORDER BY t.table_name;
      `
    );

    const tableInfo = [];
    for (const row of tables) {
      const tableName = row.table_name;
      const columns = await db.any(
        `
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
        `,
        [tableName]
      );

      const hasRaster = columns.some((col) => col.column_name === 'rast');
      const hasGeom = columns.some((col) => col.column_name === 'geom');
      tableInfo.push({ tableName, hasRaster, hasGeom });
    }

    for (let i = 0; i < coordinates.length; i += 1) {
      const [lat, lng] = coordinates[i];
      console.log(`\n=== Point ${i + 1}: (${lat}, ${lng}) ===`);

      for (const info of tableInfo) {
        if (info.hasRaster) {
          try {
            const result = await db.oneOrNone(
              `
              SELECT ST_Value(rast, ST_Transform(ST_SetSRID(ST_MakePoint($2, $1), 4326), 5070)) AS value
              FROM ${info.tableName}
              WHERE ST_Intersects(
                rast,
                ST_Buffer(ST_Transform(ST_SetSRID(ST_MakePoint($2, $1), 4326), 5070), 10)
              )
              LIMIT 1
              `,
              [lat, lng]
            );
            console.log(`${info.tableName}:`, result?.value ?? 'NULL');
          } catch (e) {
            console.log(`${info.tableName}: ERROR -`, e.message);
          }
        } else if (info.hasGeom) {
          try {
            const result = await db.oneOrNone(
              `
              SELECT 1 AS hit
              FROM ${info.tableName}
              WHERE geom IS NOT NULL
                AND ST_Intersects(
                  geom,
                  ST_Transform(
                    ST_Buffer(ST_Transform(ST_SetSRID(ST_MakePoint($2, $1), 4326), 5070), 10),
                    4326
                  )
                )
              LIMIT 1
              `,
              [lat, lng]
            );
            console.log(`${info.tableName}:`, result?.hit ? 'HIT' : 'no hit');
          } catch (e) {
            console.log(`${info.tableName}: ERROR -`, e.message);
          }
        } else {
          console.log(`${info.tableName}: skipped (no rast/geom)`);
        }
      }
    }
  } catch (error) {
    console.error('Database error:', error);
  } finally {
    pgp.end();
  }
}

queryData();
