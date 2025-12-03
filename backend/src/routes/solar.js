const express = require('express');
const router = express.Router();
const { queries } = require('../database');
const Joi = require('joi');

// Validation schemas
const pointSchema = Joi.object({
  lat: Joi.number().min(41.5).max(48.5).required(),
  lng: Joi.number().min(-90.5).max(-82.0).required(),
});

const bboxSchema = Joi.object({
  minLat: Joi.number().min(41.5).max(48.5).required(),
  minLng: Joi.number().min(-90.5).max(-82.0).required(),
  maxLat: Joi.number().min(41.5).max(48.5).required(),
  maxLng: Joi.number().min(-90.5).max(-82.0).required(),
  limit: Joi.number().min(1).max(10000).default(10000),
});

// GET /api/solar/point/:lat/:lng
// Get solar suitability data for a specific point
router.get('/point/:lat/:lng', async (req, res, next) => {
  try {
    const lat = parseFloat(req.params.lat);
    const lng = parseFloat(req.params.lng);

    // Validate coordinates
    const { error } = pointSchema.validate({ lat, lng });
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message,
      });
    }

    // Round to grid spacing
    const gridSpacing = parseFloat(process.env.GRID_SPACING) || 0.000667;
    const roundedLat = Math.round(lat / gridSpacing) * gridSpacing;
    const roundedLng = Math.round(lng / gridSpacing) * gridSpacing;

    // Try exact match first
    let data = await queries.getSolarPoint(roundedLat, roundedLng);

    // If no exact match, find nearest point
    if (!data) {
      data = await queries.getNearestSolarPoint(lat, lng);
    }

    if (!data) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'No solar data available for this location',
      });
    }

    res.json({
      success: true,
      data: {
        lat: parseFloat(data.lat),
        lng: parseFloat(data.lng),
        overall: parseFloat(data.overall_score),
        land_cover: parseFloat(data.land_cover_score),
        slope: parseFloat(data.slope_score),
        transmission: parseFloat(data.transmission_score),
        population: parseFloat(data.population_score),
        ...(data.distance_m && { distance_m: parseFloat(data.distance_m) }),
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/solar/bbox
// Get solar suitability data for a bounding box
router.get('/bbox', async (req, res, next) => {
  try {
    const { minLat, minLng, maxLat, maxLng, limit } = req.query;

    // Validate parameters
    const { error, value } = bboxSchema.validate({
      minLat: parseFloat(minLat),
      minLng: parseFloat(minLng),
      maxLat: parseFloat(maxLat),
      maxLng: parseFloat(maxLng),
      limit: limit ? parseInt(limit) : undefined,
    });

    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message,
      });
    }

    const data = await queries.getSolarDataBBox(
      value.minLat,
      value.minLng,
      value.maxLat,
      value.maxLng,
      value.limit
    );

    res.json({
      success: true,
      count: data.length,
      data: data.map((point) => ({
        lat: parseFloat(point.lat),
        lng: parseFloat(point.lng),
        overall: parseFloat(point.overall_score),
        land_cover: parseFloat(point.land_cover_score),
        slope: parseFloat(point.slope_score),
        transmission: parseFloat(point.transmission_score),
        population: parseFloat(point.population_score),
      })),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/solar/polygon
// Get solar suitability data within a polygon
router.post('/polygon', async (req, res, next) => {
  try {
    const { coordinates, limit } = req.body;

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 3) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid polygon coordinates. Must be an array of at least 3 [lng, lat] points.',
      });
    }

    // Build WKT polygon string
    const points = coordinates.map((coord) => `${coord[0]} ${coord[1]}`).join(', ');
    const polygonWKT = `POLYGON((${points}, ${coordinates[0][0]} ${coordinates[0][1]}))`;

    const maxLimit = parseInt(process.env.MAX_FARM_POINTS) || 50000;
    const queryLimit = Math.min(limit || maxLimit, maxLimit);

    const data = await queries.getSolarDataInPolygon(polygonWKT, queryLimit);

    res.json({
      success: true,
      count: data.length,
      data: data.map((point) => ({
        lat: parseFloat(point.lat),
        lng: parseFloat(point.lng),
        overall: parseFloat(point.overall_score),
        land_cover: parseFloat(point.land_cover_score),
        slope: parseFloat(point.slope_score),
        transmission: parseFloat(point.transmission_score),
        population: parseFloat(point.population_score),
      })),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/solar/stats
// Get overall statistics about solar suitability data
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await queries.getStatistics();

    res.json({
      success: true,
      data: {
        total_points: parseInt(stats.total_points),
        avg_overall: parseFloat(stats.avg_overall),
        min_overall: parseFloat(stats.min_overall),
        max_overall: parseFloat(stats.max_overall),
        stddev_overall: parseFloat(stats.stddev_overall),
        quartiles: {
          q1: parseFloat(stats.q1_overall),
          median: parseFloat(stats.median_overall),
          q3: parseFloat(stats.q3_overall),
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
