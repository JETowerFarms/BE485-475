const pgp = require('pg-promise')();
const dotenv = require('dotenv');

dotenv.config();

// Database connection configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'michigan_solar',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: parseInt(process.env.DB_MAX_CONNECTIONS) || 20,
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
  connectionTimeoutMillis: 10000,
};

// Create database instance
const db = pgp(dbConfig);

// Test database connection
async function testConnection() {
  try {
    await db.one('SELECT NOW()');
    console.log('✓ Database connection successful');
    return true;
  } catch (error) {
    console.error('✗ Database connection failed:', error.message);
    return false;
  }
}

// Helper functions for common queries
const queries = {
  // Get solar data point by exact coordinates
  getSolarPoint: async (lat, lng) => {
    return db.oneOrNone(
      `SELECT lat, lng, overall_score, land_cover_score, slope_score, 
              transmission_score, population_score
       FROM solar_suitability
       WHERE lat = $1 AND lng = $2`,
      [lat, lng]
    );
  },

  // Get nearest solar data point
  getNearestSolarPoint: async (lat, lng) => {
    return db.oneOrNone(
      `SELECT * FROM get_nearest_solar_point($1, $2)`,
      [lat, lng]
    );
  },

  // Get solar data within bounding box
  getSolarDataBBox: async (minLat, minLng, maxLat, maxLng, limit = 10000) => {
    return db.any(
      `SELECT lat, lng, overall_score, land_cover_score, slope_score,
              transmission_score, population_score
       FROM solar_suitability
       WHERE lat BETWEEN $1 AND $3
         AND lng BETWEEN $2 AND $4
       ORDER BY lat, lng
       LIMIT $5`,
      [minLat, minLng, maxLat, maxLng, limit]
    );
  },

  // Get solar data within polygon
  getSolarDataInPolygon: async (polygonWKT, limit = 50000) => {
    return db.any(
      `SELECT lat, lng, overall_score, land_cover_score, slope_score,
              transmission_score, population_score
       FROM solar_suitability
       WHERE ST_Intersects(
         location,
         ST_GeomFromText($1, 4326)::geography
       )
       LIMIT $2`,
      [polygonWKT, limit]
    );
  },

  // Calculate farm suitability
  calculateFarmSuitability: async (polygonWKT) => {
    return db.one(
      `SELECT * FROM calculate_farm_suitability(
         ST_GeomFromText($1, 4326)::geography
       )`,
      [polygonWKT]
    );
  },

  // Save farm
  saveFarm: async (userId, name, boundaryGeoJSON, areaAcres, avgSuitability) => {
    return db.one(
      `INSERT INTO farms (user_id, name, boundary, area_acres, centroid, avg_suitability)
       VALUES ($1, $2, ST_GeomFromGeoJSON($3)::geography, $4, 
               ST_Centroid(ST_GeomFromGeoJSON($3)::geography), $5)
       RETURNING id, name, area_acres, avg_suitability, created_at`,
      [userId, name, JSON.stringify(boundaryGeoJSON), areaAcres, avgSuitability]
    );
  },

  // Get user farms
  getUserFarms: async (userId) => {
    return db.any(
      `SELECT id, name, area_acres, avg_suitability, 
              ST_AsGeoJSON(boundary)::json as boundary,
              created_at, updated_at
       FROM farms
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
  },

  // Get farm by ID
  getFarmById: async (farmId) => {
    return db.oneOrNone(
      `SELECT id, user_id, name, area_acres, avg_suitability,
              ST_AsGeoJSON(boundary)::json as boundary,
              ST_AsGeoJSON(centroid)::json as centroid,
              created_at, updated_at
       FROM farms
       WHERE id = $1`,
      [farmId]
    );
  },

  // Delete farm
  deleteFarm: async (farmId, userId) => {
    return db.result(
      `DELETE FROM farms WHERE id = $1 AND user_id = $2`,
      [farmId, userId]
    );
  },

  // Get farm analysis
  getFarmAnalysis: async (farmId) => {
    return db.oneOrNone(
      `SELECT * FROM farm_analysis WHERE farm_id = $1`,
      [farmId]
    );
  },

  // Save farm analysis
  saveFarmAnalysis: async (farmId, analysisData) => {
    const {
      total_points,
      avg_overall,
      avg_land_cover,
      avg_slope,
      avg_transmission,
      avg_population,
      min_score,
      max_score,
      suitable_area_acres,
      analysis_data,
    } = analysisData;

    return db.one(
      `INSERT INTO farm_analysis 
       (farm_id, total_points, avg_overall, avg_land_cover, avg_slope,
        avg_transmission, avg_population, min_score, max_score,
        suitable_area_acres, analysis_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (farm_id) DO UPDATE SET
         total_points = EXCLUDED.total_points,
         avg_overall = EXCLUDED.avg_overall,
         avg_land_cover = EXCLUDED.avg_land_cover,
         avg_slope = EXCLUDED.avg_slope,
         avg_transmission = EXCLUDED.avg_transmission,
         avg_population = EXCLUDED.avg_population,
         min_score = EXCLUDED.min_score,
         max_score = EXCLUDED.max_score,
         suitable_area_acres = EXCLUDED.suitable_area_acres,
         analysis_data = EXCLUDED.analysis_data,
         created_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        farmId,
        total_points,
        avg_overall,
        avg_land_cover,
        avg_slope,
        avg_transmission,
        avg_population,
        min_score,
        max_score,
        suitable_area_acres,
        JSON.stringify(analysis_data),
      ]
    );
  },

  // Get statistics
  getStatistics: async () => {
    return db.one(`SELECT * FROM solar_suitability_stats`);
  },

  // Get counties
  getCounties: async () => {
    return db.any(
      `SELECT id, name, fips_code, ST_AsGeoJSON(boundary)::json as boundary
       FROM counties
       ORDER BY name`
    );
  },

  // Get cities by county
  getCitiesByCounty: async (countyId) => {
    return db.any(
      `SELECT id, name, population, ST_AsGeoJSON(location)::json as location
       FROM cities
       WHERE county_id = $1
       ORDER BY name`,
      [countyId]
    );
  },
};

module.exports = {
  db,
  queries,
  testConnection,
};
