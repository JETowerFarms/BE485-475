const express = require('express');
const router = express.Router();
const { queries, getDbConnectionHint, isDbConnectionError } = require('../database');
const Joi = require('joi');
const geo = require('../utils/geometry');

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

const updateFarmSchema = Joi.object({
  userId: Joi.string().required(),
  name: Joi.string().min(1).max(200).required(),
});

const calculateAreaAcres = (coordinates) => {
  return geo.polygonAreaAcres(coordinates);
};

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
    console.error('Error getting user farms:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve farms'
    });
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
    console.error('Error getting farm by ID:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve farm'
    });
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

    // Ensure polygon ring is closed
    let ring = [...coordinates];
    if (ring.length > 0) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        ring = [...ring, first];
      }
    }

    // Create GeoJSON polygon
    const boundaryGeoJSON = {
      type: 'Polygon',
      coordinates: [ring],
    };

    // Validate boundary GeoJSON
    if (!boundaryGeoJSON.coordinates || !boundaryGeoJSON.coordinates[0] || boundaryGeoJSON.coordinates[0].length < 4) {
      return res.status(400).json({
        error: 'Invalid Geometry',
        message: 'Farm boundary must have at least 3 points to form a valid polygon',
      });
    }

    // Calculate area if not provided
    let calculatedAcres = areaAcres;
    if (calculatedAcres === undefined || calculatedAcres === null) {
      calculatedAcres = calculateAreaAcres(coordinates);
    }

    // Validate calculated values
    if (!calculatedAcres || isNaN(calculatedAcres) || calculatedAcres <= 0) {
      return res.status(400).json({
        error: 'Invalid Area',
        message: 'Farm area must be a positive number',
      });
    }

    // Validate farm size - fail fast for farms over 1000 acres
    const MAX_FARM_ACRES = 1000;
    if (calculatedAcres > MAX_FARM_ACRES) {
      return res.status(422).json({
        error: 'Farm Too Large',
        message: `Farm area of ${calculatedAcres.toFixed(1)} acres exceeds the maximum allowed size of ${MAX_FARM_ACRES} acres. Please break your farm into smaller sections and create multiple farms.`,
        farmArea: calculatedAcres,
        maxAllowedArea: MAX_FARM_ACRES
      });
    }

    // Save farm
    let farm;
    try {
      console.log('Attempting to save farm:', {
        userId,
        name,
        boundaryGeoJSON: boundaryGeoJSON ? 'valid' : 'null',
        calculatedAcres,
        avgSuitability: null
      });
      
      farm = await queries.saveFarm(
        userId,
        name,
        boundaryGeoJSON,
        calculatedAcres,
        null
      );
      
      console.log('Farm saved successfully:', farm);
    } catch (saveError) {
      console.error('Error saving farm to database:', saveError);
      console.error('Error details:', {
        message: saveError.message,
        code: saveError.code,
        detail: saveError.detail,
        hint: saveError.hint
      });
      return res.status(400).json({
        error: 'Database Error',
        message: 'Failed to save farm to database',
        details: saveError.message
      });
    }

    const responseData = {
      success: true,
      data: {
        id: farm.id,
        name: farm.name,
        areaAcres: parseFloat(farm.area_acres),
        avgSuitability: farm.avg_suitability == null ? null : parseFloat(farm.avg_suitability),
        createdAt: farm.created_at,
        coordinates: ring
      }
    };

    // Log response size for monitoring
    const responseSizeBytes = Buffer.byteLength(JSON.stringify(responseData), 'utf8');
    console.log(`Farm creation response size: ${(responseSizeBytes / 1024 / 1024).toFixed(2)} MB (${responseSizeBytes} bytes)`);

    res.status(201).json(responseData);
  } catch (error) {
    console.error('Error creating farm:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create farm'
    });
  }
});

// PUT /api/farms/:id
// Update farm name for a specific farm
router.put('/:id', async (req, res, next) => {
  try {
    const farmId = parseInt(req.params.id);

    const { error: idError } = farmIdSchema.validate({ farmId });
    if (idError) {
      return res.status(400).json({
        error: 'Validation Error',
        message: idError.details[0].message,
      });
    }

    const { error: bodyError, value } = updateFarmSchema.validate(req.body);
    if (bodyError) {
      return res.status(400).json({
        error: 'Validation Error',
        message: bodyError.details[0].message,
      });
    }

    const { userId, name } = value;

    let updatedFarm;
    try {
      updatedFarm = await queries.updateFarmName(farmId, userId, name);
    } catch (dbError) {
      console.error('Error updating farm name in database:', dbError);
      const hint = getDbConnectionHint(dbError);
      return res.status(500).json({
        error: 'Database Error',
        message: 'Failed to update farm name',
        hint,
      });
    }

    if (!updatedFarm) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Farm not found or you do not have permission to update it',
      });
    }

    return res.json({
      success: true,
      data: {
        id: updatedFarm.id,
        name: updatedFarm.name,
        areaAcres: parseFloat(updatedFarm.area_acres),
        avgSuitability: updatedFarm.avg_suitability == null ? null : parseFloat(updatedFarm.avg_suitability),
        boundary: updatedFarm.boundary,
        createdAt: updatedFarm.created_at,
        updatedAt: updatedFarm.updated_at,
      },
    });
  } catch (error) {
    console.error('Error updating farm:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update farm',
    });
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
    console.error('Error deleting farm:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete farm'
    });
  }
});

module.exports = router;
