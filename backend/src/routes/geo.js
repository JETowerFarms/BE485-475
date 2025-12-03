const express = require('express');
const router = express.Router();
const { queries } = require('../database');

// GET /api/geo/counties
// Get all Michigan counties
router.get('/counties', async (req, res, next) => {
  try {
    const counties = await queries.getCounties();

    res.json({
      success: true,
      count: counties.length,
      data: counties.map((county) => ({
        id: county.id,
        name: county.name,
        fipsCode: county.fips_code,
        boundary: county.boundary,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/geo/cities/:countyId
// Get cities in a specific county
router.get('/cities/:countyId', async (req, res, next) => {
  try {
    const countyId = parseInt(req.params.countyId);

    if (isNaN(countyId)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid county ID',
      });
    }

    const cities = await queries.getCitiesByCounty(countyId);

    res.json({
      success: true,
      count: cities.length,
      data: cities.map((city) => ({
        id: city.id,
        name: city.name,
        population: city.population,
        location: city.location,
      })),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
