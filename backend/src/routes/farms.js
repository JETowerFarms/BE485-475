const express = require('express');
const router = express.Router();
const { queries, getDbConnectionHint, isDbConnectionError } = require('../database');
const Joi = require('joi');
const {
  buildNlcdClassBreakdown,
  estimateSitePrepCostUsd,
  isFullyWaterFromNlcd,
} = require('../landcover');
const { getOrCreatePricingSnapshot } = require('../pricing');
const {
  calculateAverageSolarScores,
  generateSolarHeatMapGrid,
  getSolarScoreDistribution,
} = require('../solar-suitability');

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

const analyzeFarmSchema = Joi.object({
  farmId: Joi.string().required(),
  coordinates: Joi.array()
    .items(Joi.array().length(2).items(Joi.number()))
    .min(4)
    .required(),
  county: Joi.string().required(),
  city: Joi.string().required(),
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

    // Build WKT for suitability calculation
    const points = ring.map((coord) => `${coord[0]} ${coord[1]}`).join(', ');
    const polygonWKT = `POLYGON((${points}))`;

    // Calculate farm suitability
    const suitability = await queries.calculateFarmSuitability(polygonWKT);

    // Calculate area if not provided
    const gridSpacing = parseFloat(process.env.GRID_SPACING) || 0.000667;
    const acresPerPoint = 0.96; // legacy approximation fallback
    const computedArea = calculatePolygonArea(ring);
    const calculatedAcres =
      areaAcres ||
      (computedArea.acres > 0 ? computedArea.acres : parseInt(suitability.total_points) * acresPerPoint);

    // Build landcover report (and hard-stop if farm is 100% open water)
    const boundaryGeoJSONString = JSON.stringify(boundaryGeoJSON);
    let nlcdCounts;
    let waterFlags;
    let waterExamples;
    let waterPercents;
    let additionalLayerPercents;
    try {
      nlcdCounts = await queries.getNlcdValueCountsForGeoJSON(boundaryGeoJSONString);
      waterFlags = await queries.getWaterFeatureFlagsForGeoJSON(boundaryGeoJSONString);
      waterExamples = await queries.getWaterFeatureExamplesForGeoJSON(boundaryGeoJSONString, 5);
      const bufferMetersRaw = process.env.LANDCOVER_WATER_BUFFER_METERS;
      const bufferMeters = bufferMetersRaw ? Number(bufferMetersRaw) : 10;
      waterPercents = await queries.getWaterFeatureCoveragePercentsForGeoJSON(
        boundaryGeoJSONString,
        Number.isFinite(bufferMeters) && bufferMeters > 0 ? bufferMeters : 10
      );
      additionalLayerPercents = await queries.getAdditionalLayerCoveragePercentsForGeoJSON(
        boundaryGeoJSONString,
        Number.isFinite(bufferMeters) && bufferMeters > 0 ? bufferMeters : 10
      );
    } catch (dbError) {
      if (isDbConnectionError(dbError)) {
        const hint = getDbConnectionHint();
        return res.status(503).json({
          error: 'Database Unavailable',
          message: `Cannot reach Postgres at ${hint.host}:${hint.port} (db: ${hint.database}, user: ${hint.user}). Start the database or update backend env vars (DB_HOST/DB_PORT/DB_USER/DB_PASSWORD).`,
        });
      }

      // Undefined table
      if (dbError && dbError.code === '42P01') {
        return res.status(503).json({
          error: 'Landcover Not Ready',
          message:
            'Landcover tables are missing. Run scripts/import-landcover-datasets.ps1 (or at minimum apply backend/sql/landcover_schema.sql and import NLCD) and try again.',
        });
      }

      throw dbError;
    }

    const nlcd = buildNlcdClassBreakdown(nlcdCounts);
    const isFullyWater = isFullyWaterFromNlcd(nlcd);

    let pricing;
    try {
      pricing = await getOrCreatePricingSnapshot(queries);
    } catch (pricingError) {
      const status = pricingError.statusCode || 503;
      return res.status(status).json({
        error: 'Live Pricing Unavailable',
        message: pricingError.message,
        ...(pricingError.details && { details: pricingError.details }),
      });
    }

    const sitePrepCost = estimateSitePrepCostUsd({
      areaAcres: calculatedAcres,
      classBreakdown: nlcd,
      pricingSnapshot: pricing.snapshot,
    });

    const landcoverReport = {
      generatedAt: new Date().toISOString(),
      farm: {
        name,
        areaAcres: calculatedAcres,
      },
      nlcd: {
        totalCells: nlcd.totalCells,
        waterCells: nlcd.waterCells,
        waterPercent: nlcd.waterPercent,
        classes: nlcd.classes,
      },
      water: {
        isFullyWater,
        hasWaterbody: Boolean(waterFlags?.has_waterbody),
        hasLake: Boolean(waterFlags?.has_lake),
        hasRiver: Boolean(waterFlags?.has_river),
        coveragePercentByTable: (waterPercents || []).map((r) => ({
          table: r.table_name,
          percent: r.percent == null ? null : Number(r.percent),
          coveredM2: r.covered_m2 == null ? null : Number(r.covered_m2),
          farmAreaM2: r.farm_area_m2 == null ? null : Number(r.farm_area_m2),
        })),
        examples: (waterExamples || []).map((e) => ({
          table: e.table_name,
          sourceFile: e.source_file,
          attrs: e.attrs,
        })),
      },
      layers: {
        coveragePercentByTable: (additionalLayerPercents || []).map((r) => ({
          table: r.table_name,
          percent: r.percent == null ? null : Number(r.percent),
          coveredM2: r.covered_m2 == null ? null : Number(r.covered_m2),
          farmAreaM2: r.farm_area_m2 == null ? null : Number(r.farm_area_m2),
        })),
      },
      sitePrepCost: {
        estimatedTotalUsd: sitePrepCost.estimatedTotalUsd,
        estimatedPerAcreUsd: sitePrepCost.estimatedPerAcreUsd,
        breakdown: sitePrepCost.breakdown,
        equations: sitePrepCost.equations || null,
        pricingSnapshot: {
          id: pricing.snapshotId,
          retrievedAt: pricing.retrievedAt,
          fromCache: pricing.fromCache,
          sources: sitePrepCost.pricingSnapshotMeta?.sources || pricing.snapshot?.sources || null,
        },
      },
    };

    if (isFullyWater) {
      return res.status(422).json({
        error: 'Farm Invalid',
        message: 'Farm is 100% open water (NLCD class 11).',
        landcoverReport,
      });
    }

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

    // Persist landcover report
    await queries.saveFarmLandcoverReport(farm.id, landcoverReport);

    res.status(201).json({
      success: true,
      data: {
        id: farm.id,
        name: farm.name,
        areaAcres: parseFloat(farm.area_acres),
        avgSuitability: parseFloat(farm.avg_suitability),
        createdAt: farm.created_at,
        analysis: analysisData,
        landcoverReport,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/farms/:id/landcover-report
// Get the latest landcover report for a farm
router.get('/:id/landcover-report', async (req, res, next) => {
  try {
    const farmId = parseInt(req.params.id);

    const { error } = farmIdSchema.validate({ farmId });
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message,
      });
    }

    const row = await queries.getLatestFarmLandcoverReport(farmId);
    if (!row) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Landcover report not found',
      });
    }

    res.json({
      success: true,
      data: {
        id: row.id,
        farmId: row.farm_id,
        createdAt: row.created_at,
        report: row.report,
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

// Helper: Calculate polygon area using Shoelace formula
function calculatePolygonArea(coordinates) {
  if (!coordinates || coordinates.length < 3) {
    return { acres: 0, sqMiles: 0 };
  }

  let coords = [...coordinates];
  if (coords.length > 1) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) {
      coords = coords.slice(0, -1);
    }
  }

  const avgLat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
  const latRad = avgLat * Math.PI / 180;

  const metersPerDegreeLat = 111132.92 - 559.82 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
  const metersPerDegreeLng = 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad);

  let area = 0;
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = coords[i][0] * metersPerDegreeLng;
    const y1 = coords[i][1] * metersPerDegreeLat;
    const x2 = coords[j][0] * metersPerDegreeLng;
    const y2 = coords[j][1] * metersPerDegreeLat;
    area += x1 * y2 - x2 * y1;
  }
  area = Math.abs(area) / 2;

  const acres = area / 4046.8564224;
  const sqMiles = area / 2589988.110336;

  return { acres, sqMiles };
}

// Helper: Calculate centroid
function calculateCentroid(coordinates) {
  if (!coordinates || coordinates.length === 0) return null;
  
  let coords = [...coordinates];
  if (coords.length > 1) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) {
      coords = coords.slice(0, -1);
    }
  }
  
  let sumLat = 0, sumLng = 0;
  coords.forEach(coord => {
    sumLng += coord[0];
    sumLat += coord[1];
  });
  
  return {
    latitude: sumLat / coords.length,
    longitude: sumLng / coords.length,
  };
}

// Solar gradient color calculation (matches frontend)
const SOLAR_GRADIENT_STOPS = [
  { position: 0, color: { r: 130, g: 13, b: 13 } },     // deep red
  { position: 0.4, color: { r: 245, g: 176, b: 23 } },  // rich amber
  { position: 1, color: { r: 16, g: 122, b: 55 } },     // deep green
];

function getSolarGradientColor(value) {
  const clamped = Math.min(1, Math.max(0, Math.pow(value, 0.7)));
  for (let i = 0; i < SOLAR_GRADIENT_STOPS.length - 1; i++) {
    const start = SOLAR_GRADIENT_STOPS[i];
    const end = SOLAR_GRADIENT_STOPS[i + 1];
    if (clamped >= start.position && clamped <= end.position) {
      const localT = (clamped - start.position) / (end.position - start.position);
      const r = Math.round(start.color.r + (end.color.r - start.color.r) * localT);
      const g = Math.round(start.color.g + (end.color.g - start.color.g) * localT);
      const b = Math.round(start.color.b + (end.color.b - start.color.b) * localT);
      return `rgb(${r},${g},${b})`;
    }
  }
  const last = SOLAR_GRADIENT_STOPS[SOLAR_GRADIENT_STOPS.length - 1];
  return `rgb(${last.color.r},${last.color.g},${last.color.b})`;
}

function getSolarGradientColorForScore(score) {
  if (score == null || Number.isNaN(score)) {
    return getSolarGradientColor(0);
  }
  const normalized = Math.min(1, Math.max(0, score / 100));
  return getSolarGradientColor(normalized);
}

// Generate heat map grid with colors for rendering
function generateHeatMapGrid(dataPoints, bounds, gridSize = 50) {
  if (!dataPoints || dataPoints.length === 0) {
    return { width: 0, height: 0, cells: [] };
  }

  const { minLat, maxLat, minLng, maxLng } = bounds;
  const latRange = maxLat - minLat;
  const lngRange = maxLng - minLng;
  
  // Determine grid dimensions based on aspect ratio
  const aspectRatio = latRange / lngRange;
  let gridWidth = gridSize;
  let gridHeight = Math.round(gridSize * aspectRatio);
  
  // Ensure minimum size
  if (gridHeight < 10) {
    gridHeight = 10;
    gridWidth = Math.round(gridHeight / aspectRatio);
  }
  
  const cellWidth = lngRange / gridWidth;
  const cellHeight = latRange / gridHeight;
  
  // Create grid cells
  const cells = [];
  
  for (let row = 0; row < gridHeight; row++) {
    for (let col = 0; col < gridWidth; col++) {
      const cellMinLat = minLat + (row * cellHeight);
      const cellMaxLat = cellMinLat + cellHeight;
      const cellMinLng = minLng + (col * cellWidth);
      const cellMaxLng = cellMinLng + cellWidth;
      const cellCenterLat = (cellMinLat + cellMaxLat) / 2;
      const cellCenterLng = (cellMinLng + cellMaxLng) / 2;
      
      // Find data points within this cell
      const cellPoints = dataPoints.filter(p => 
        p.lat >= cellMinLat && p.lat < cellMaxLat &&
        p.lng >= cellMinLng && p.lng < cellMaxLng
      );
      
      // Calculate average score for cell
      let score = null;
      if (cellPoints.length > 0) {
        const sum = cellPoints.reduce((acc, p) => acc + p.overall, 0);
        score = sum / cellPoints.length;
      }
      
      // Get color for this cell
      const color = score !== null ? getSolarGradientColorForScore(score) : null;
      
      cells.push({
        row,
        col,
        lat: cellCenterLat,
        lng: cellCenterLng,
        score,
        color,
        pointCount: cellPoints.length
      });
    }
  }
  
  return {
    width: gridWidth,
    height: gridHeight,
    cellWidth,
    cellHeight,
    cells: cells.filter(c => c.score !== null) // Only include cells with data
  };
}

// Elevation color calculation (green -> tan -> brown gradient)
function getElevationColorFromNormalized(normalized) {
  if (normalized < 0.33) {
    // Low elevation: Green to yellow-green
    const t = normalized / 0.33;
    const r = Math.floor(34 + (154 - 34) * t);
    const g = Math.floor(139 + (205 - 139) * t);
    const b = Math.floor(34 + (50 - 34) * t);
    return `rgb(${r},${g},${b})`;
  } else if (normalized < 0.67) {
    // Mid elevation: Yellow-green to tan/beige
    const t = (normalized - 0.33) / 0.34;
    const r = Math.floor(154 + (210 - 154) * t);
    const g = Math.floor(205 + (180 - 205) * t);
    const b = Math.floor(50 + (140 - 50) * t);
    return `rgb(${r},${g},${b})`;
  } else {
    // High elevation: Tan to brown/red
    const t = (normalized - 0.67) / 0.33;
    const r = Math.floor(210 + (139 - 210) * t);
    const g = Math.floor(180 + (90 - 180) * t);
    const b = Math.floor(140 + (43 - 140) * t);
    return `rgb(${r},${g},${b})`;
  }
}

// Generate elevation heat map grid with colors
function generateElevationHeatMapGrid(dataPoints, bounds, gridSize = 50) {
  if (!dataPoints || dataPoints.length === 0) {
    return { width: 0, height: 0, cells: [] };
  }

  const { minLat, maxLat, minLng, maxLng } = bounds;
  const latRange = maxLat - minLat;
  const lngRange = maxLng - minLng;
  
  // Determine grid dimensions based on aspect ratio
  const aspectRatio = latRange / lngRange;
  let gridWidth = gridSize;
  let gridHeight = Math.round(gridSize * aspectRatio);
  
  if (gridHeight < 10) {
    gridHeight = 10;
    gridWidth = Math.round(gridHeight / aspectRatio);
  }
  
  const cellWidth = lngRange / gridWidth;
  const cellHeight = latRange / gridHeight;
  
  // Collect all slope values for ranking
  const cellData = [];
  for (let row = 0; row < gridHeight; row++) {
    for (let col = 0; col < gridWidth; col++) {
      const cellCenterLat = minLat + (row + 0.5) * cellHeight;
      const cellCenterLng = minLng + (col + 0.5) * cellWidth;
      
      // Find nearest data point
      const cellPoints = dataPoints.filter(p => 
        Math.abs(p.lat - cellCenterLat) < cellHeight &&
        Math.abs(p.lng - cellCenterLng) < cellWidth
      );
      
      let slope = 0;
      if (cellPoints.length > 0) {
        const sum = cellPoints.reduce((acc, p) => acc + p.slope, 0);
        slope = sum / cellPoints.length;
      }
      
      cellData.push({ row, col, slope, lat: cellCenterLat, lng: cellCenterLng });
    }
  }
  
  // Build rank lookup
  const sortedSlopes = [...cellData.map(c => c.slope)].sort((a, b) => a - b);
  const slopeToRank = new Map();
  const denom = Math.max(sortedSlopes.length - 1, 1);
  sortedSlopes.forEach((value, index) => {
    if (!slopeToRank.has(value)) {
      slopeToRank.set(value, index / denom);
    }
  });
  
  // Generate cells with colors based on rank
  const cells = cellData.map(cell => {
    const normalized = slopeToRank.get(cell.slope) || 0;
    const color = getElevationColorFromNormalized(normalized);
    
    return {
      row: cell.row,
      col: cell.col,
      lat: cell.lat,
      lng: cell.lng,
      slope: cell.slope,
      color,
    };
  });
  
  return {
    width: gridWidth,
    height: gridHeight,
    cellWidth,
    cellHeight,
    cells,
  };
}

// POST /api/farms/analyze
// Analyze farm polygon and return pre-fetched solar data
router.post('/analyze', async (req, res, next) => {
  try {
    const startTime = Date.now();
    
    // Validate request
    const { error, value } = analyzeFarmSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message,
      });
    }

    const { farmId, coordinates, county, city } = value;

    // Ensure polygon ring is closed
    const ring = Array.isArray(coordinates) ? coordinates.slice() : [];
    if (ring.length > 0) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (!last || first?.[0] !== last?.[0] || first?.[1] !== last?.[1]) {
        ring.push(first);
      }
    }

    // Calculate metadata
    const area = calculatePolygonArea(ring);
    const centroid = calculateCentroid(ring);
    
    // Calculate bounds
    const lats = ring.map(c => c[1]);
    const lngs = ring.map(c => c[0]);
    const bounds = {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
    };

    // Query solar data within polygon from database (using bounding box)
    let solarDataPoints;
    try {
      solarDataPoints = await queries.getSolarDataInPolygon(ring, 50000);
    } catch (dbError) {
      if (isDbConnectionError(dbError)) {
        const hint = getDbConnectionHint();
        return res.status(503).json({
          error: 'Database Unavailable',
          message: `Cannot reach Postgres at ${hint.host}:${hint.port} (db: ${hint.database}, user: ${hint.user}). Start the database or update backend env vars (DB_HOST/DB_PORT/DB_USER/DB_PASSWORD).`,
        });
      }
      throw dbError;
    }

    // Format data points to match frontend expectations
    const formattedPoints = solarDataPoints.map(point => ({
      lat: parseFloat(point.lat),
      lng: parseFloat(point.lng),
      overall: parseFloat(point.overall_score),
      land_cover: parseFloat(point.land_cover_score),
      slope: parseFloat(point.slope_score),
      transmission: parseFloat(point.transmission_score),
      population: parseFloat(point.population_score),
    }));

    // Calculate average suitability using solar-suitability module
    const solarScores = calculateAverageSolarScores(solarDataPoints);
    const solarDistribution = getSolarScoreDistribution(solarDataPoints);

    // Generate solar heat map grid with pre-computed colors
    const solarHeatMapGrid = generateSolarHeatMapGrid(solarDataPoints, bounds, 50);

    // Generate elevation heat map grid with pre-computed colors
    const elevationHeatMapGrid = generateElevationHeatMapGrid(formattedPoints, bounds, 50);

    // Landcover report (NLCD + water layers + live pricing snapshot). Non-fatal on missing landcover tables or pricing.
    let landcoverReport = null;
    let landcoverReportError = null;
    try {
      const boundaryGeoJSON = {
        type: 'Polygon',
        coordinates: [ring],
      };
      const boundaryGeoJSONString = JSON.stringify(boundaryGeoJSON);

      const nlcdCounts = await queries.getNlcdValueCountsForGeoJSON(boundaryGeoJSONString);
      const waterFlags = await queries.getWaterFeatureFlagsForGeoJSON(boundaryGeoJSONString);
      const waterExamples = await queries.getWaterFeatureExamplesForGeoJSON(boundaryGeoJSONString, 5);
      const bufferMetersRaw = process.env.LANDCOVER_WATER_BUFFER_METERS;
      const bufferMeters = Number.isFinite(Number(bufferMetersRaw))
        ? Number(bufferMetersRaw)
        : 10;
      const waterCoverageByTable = await queries.getWaterFeatureCoveragePercentsForGeoJSON(
        boundaryGeoJSONString,
        bufferMeters
      );
      const additionalCoverageByTable = await queries.getAdditionalLayerCoveragePercentsForGeoJSON(
        boundaryGeoJSONString,
        bufferMeters
      );

      const nlcd = buildNlcdClassBreakdown(nlcdCounts);
      const isFullyWater = isFullyWaterFromNlcd(nlcd);

      let pricing = null;
      try {
        pricing = await getOrCreatePricingSnapshot(queries);
      } catch (pricingError) {
        landcoverReportError = {
          error: 'Live Pricing Unavailable',
          message: pricingError.message,
          ...(pricingError.details && { details: pricingError.details }),
        };
      }

      const sitePrepCost = pricing
        ? estimateSitePrepCostUsd({
            areaAcres: area?.acres || 0,
            classBreakdown: nlcd,
            pricingSnapshot: pricing.snapshot,
          })
        : null;

      landcoverReport = {
        generatedAt: new Date().toISOString(),
        farm: {
          id: farmId,
          areaAcres: area?.acres || 0,
        },
        nlcd: {
          totalCells: nlcd.totalCells,
          waterCells: nlcd.waterCells,
          waterPercent: nlcd.waterPercent,
          classes: nlcd.classes,
        },
        water: {
          isFullyWater,
          hasWaterbody: Boolean(waterFlags?.has_waterbody),
          hasLake: Boolean(waterFlags?.has_lake),
          hasRiver: Boolean(waterFlags?.has_river),
          coveragePercentByTable: (waterCoverageByTable || []).map((r) => ({
            table: r.table_name,
            percent: r.percent,
            coveredM2: r.covered_m2,
            farmAreaM2: r.farm_area_m2,
          })),
          examples: (waterExamples || []).map((e) => ({
            table: e.table_name,
            sourceFile: e.source_file,
            attrs: e.attrs,
          })),
        },
        layers: {
          coveragePercentByTable: (additionalCoverageByTable || []).map((r) => ({
            table: r.table_name,
            percent: r.percent,
            coveredM2: r.covered_m2,
            farmAreaM2: r.farm_area_m2,
          })),
        },
        sitePrepCost: sitePrepCost
          ? {
              estimatedTotalUsd: sitePrepCost.estimatedTotalUsd,
              estimatedPerAcreUsd: sitePrepCost.estimatedPerAcreUsd,
              breakdown: sitePrepCost.breakdown,
              equations: sitePrepCost.equations || null,
              pricingSnapshot: {
                id: pricing.snapshotId,
                retrievedAt: pricing.retrievedAt,
                fromCache: pricing.fromCache,
                sources: sitePrepCost.pricingSnapshotMeta?.sources || pricing.snapshot?.sources || null,
              },
            }
          : null,
      };
    } catch (landcoverError) {
      if (landcoverError && landcoverError.code === '42P01') {
        landcoverReportError = {
          error: 'Landcover Not Ready',
          message:
            'Landcover tables are missing. Run scripts/import-landcover-datasets.ps1 (or at minimum apply backend/sql/landcover_schema.sql and import NLCD) and try again.',
        };
      } else {
        landcoverReportError = {
          error: 'Landcover Unavailable',
          message: landcoverError?.message || String(landcoverError),
        };
      }
    }

    const processingTimeMs = Date.now() - startTime;

    res.json({
      farmId,
      metadata: {
        area,
        bounds,
        centroid,
        avgSuitability: parseFloat(solarScores.overall.toFixed(2)),
        solarScores: {
          overall: parseFloat(solarScores.overall.toFixed(2)),
          landCover: parseFloat(solarScores.landCover.toFixed(2)),
          slope: parseFloat(solarScores.slope.toFixed(2)),
          transmission: parseFloat(solarScores.transmission.toFixed(2)),
          population: parseFloat(solarScores.population.toFixed(2)),
        },
        solarDistribution: {
          min: parseFloat(solarDistribution.min.toFixed(2)),
          max: parseFloat(solarDistribution.max.toFixed(2)),
          median: parseFloat(solarDistribution.median.toFixed(2)),
          q25: parseFloat(solarDistribution.q25.toFixed(2)),
          q75: parseFloat(solarDistribution.q75.toFixed(2)),
        },
      },
      solarDataPoints: formattedPoints,
      solarHeatMapGrid,
      elevationHeatMapGrid,
      landcoverReport,
      landcoverReportError,
      dataPointCount: formattedPoints.length,
      processingTimeMs,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
