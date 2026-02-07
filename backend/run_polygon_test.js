const pgp = require('pg-promise')();
const dotenv = require('dotenv');

dotenv.config();

const db = pgp({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'michigan_solar',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD
});

const coords = [
  [42.66988, -83.371120],
  [42.670101, -83.369972],
  [42.668736, -83.370723],
  [42.669139, -83.369221]
];

const ring = coords.map(([lat, lng]) => `${lng} ${lat}`);
ring.push(ring[0]);
const wkt = `POLYGON((${ring.join(', ')}))`;

(async () => {
  try {
    const result = await db.one(
      'SELECT * FROM calculate_farm_suitability(ST_GeomFromText($1, 4326)::geography)',
      [wkt]
    );
    console.log('WKT:', wkt);
    console.log('Result:', result);
  } catch (err) {
    console.error('Error:', err.message || err);
  } finally {
    pgp.end();
  }
})();
