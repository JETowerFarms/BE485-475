const express = require('express');
const router = express.Router();
const { queries } = require('../database');
const Joi = require('joi');

// Validation schemas
const createFarmSchema = Joi.object({
  userId: Joi.string().required(),
  name: Joi.string().min(1).max(200).required(),
  coordinates: Joi.array()
    .items(Joi.array().length(2).items(Joi.number()))
    .min(3)
    .required(),
  areaAcres: Joi.number().min(0).optional(),
});

const farmIdSchema = Joi.object({
  farmId: Joi.number().integer().positive().required(),
});

// GET /api/farms
// Get all farms for a user
router.get('/', async (req, res, next) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'userId query parameter is required',
      });
    }

    const farms = await queries.getUserFarms(userId);

    res.json({
      success: true,
      count: farms.length,
      data: farms.map((farm) => ({
        id: farm.id,
        name: farm.name,
        areaAcres: parseFloat(farm.area_acres),
        avgSuitability: parseFloat(farm.avg_suitability),
        boundary: farm.boundary,
        createdAt: farm.created_at,
        updatedAt: farm.updated_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/farms/:id
// Get a specific farm by ID
router.get('/:id', async (req, res, next) => {
  try {
    const farmId = parseInt(req.params.id);

    const { error } = farmIdSchema.validate({ farmId });
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message,
      });
    }

    const farm = await queries.getFarmById(farmId);

    if (!farm) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Farm not found',
      });
    }

    res.json({
      success: true,
      data: {
        id: farm.id,
        userId: farm.user_id,
        name: farm.name,
        areaAcres: parseFloat(farm.area_acres),
        avgSuitability: parseFloat(farm.avg_suitability),
        boundary: farm.boundary,
        centroid: farm.centroid,
        createdAt: farm.created_at,
        updatedAt: farm.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/farms
// Create a new farm and calculate its suitability
router.post('/', async (req, res, next) => {
  try {
    const { error, value } = createFarmSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message,
      });
    }

    const { userId, name, coordinates, areaAcres } = value;

    // Create GeoJSON polygon
    const boundaryGeoJSON = {
      type: 'Polygon',
      coordinates: [coordinates],
    };

    // Build WKT for suitability calculation
    const points = coordinates.map((coord) => `${coord[0]} ${coord[1]}`).join(', ');
    const polygonWKT = `POLYGON((${points}, ${coordinates[0][0]} ${coordinates[0][1]}))`;

    // Calculate farm suitability
    const suitability = await queries.calculateFarmSuitability(polygonWKT);

    // Calculate area if not provided (using point count as approximation)
    const gridSpacing = parseFloat(process.env.GRID_SPACING) || 0.000667;
    const acresPerPoint = 0.96; // Approximate acres per grid point
    const calculatedAcres = areaAcres || parseInt(suitability.total_points) * acresPerPoint;

    // Save farm
    const farm = await queries.saveFarm(
      userId,
      name,
      boundaryGeoJSON,
      calculatedAcres,
      parseFloat(suitability.avg_overall)
    );

    // Save detailed analysis
    const analysisData = {
      total_points: parseInt(suitability.total_points),
      avg_overall: parseFloat(suitability.avg_overall),
      avg_land_cover: parseFloat(suitability.avg_land_cover),
      avg_slope: parseFloat(suitability.avg_slope),
      avg_transmission: parseFloat(suitability.avg_transmission),
      avg_population: parseFloat(suitability.avg_population),
      min_score: parseFloat(suitability.min_score),
      max_score: parseFloat(suitability.max_score),
      suitable_area_acres: calculatedAcres * (parseFloat(suitability.avg_overall) / 100),
      analysis_data: {
        grid_spacing: gridSpacing,
        calculated_at: new Date().toISOString(),
      },
    };

    await queries.saveFarmAnalysis(farm.id, analysisData);

    res.status(201).json({
      success: true,
      data: {
        id: farm.id,
        name: farm.name,
        areaAcres: parseFloat(farm.area_acres),
        avgSuitability: parseFloat(farm.avg_suitability),
        createdAt: farm.created_at,
        analysis: analysisData,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/farms/:id/analysis
// Get detailed analysis for a farm
router.get('/:id/analysis', async (req, res, next) => {
  try {
    const farmId = parseInt(req.params.id);

    const { error } = farmIdSchema.validate({ farmId });
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message,
      });
    }

    const analysis = await queries.getFarmAnalysis(farmId);

    if (!analysis) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Farm analysis not found',
      });
    }

    res.json({
      success: true,
      data: {
        farmId: analysis.farm_id,
        totalPoints: parseInt(analysis.total_points),
        averages: {
          overall: parseFloat(analysis.avg_overall),
          landCover: parseFloat(analysis.avg_land_cover),
          slope: parseFloat(analysis.avg_slope),
          transmission: parseFloat(analysis.avg_transmission),
          population: parseFloat(analysis.avg_population),
        },
        range: {
          min: parseFloat(analysis.min_score),
          max: parseFloat(analysis.max_score),
        },
        suitableAreaAcres: parseFloat(analysis.suitable_area_acres),
        details: analysis.analysis_data,
        calculatedAt: analysis.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/farms/:id
// Delete a farm
router.delete('/:id', async (req, res, next) => {
  try {
    const farmId = parseInt(req.params.id);
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'userId query parameter is required',
      });
    }

    const { error } = farmIdSchema.validate({ farmId });
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message,
      });
    }

    const result = await queries.deleteFarm(farmId, userId);

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Farm not found or you do not have permission to delete it',
      });
    }

    res.json({
      success: true,
      message: 'Farm deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
