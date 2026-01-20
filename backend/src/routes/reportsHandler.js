/**
 * Report Handler
 * Receives coordinates from the app, feeds them to farm resolution,
 * and processes solar suitability analysis using the new parser pipeline
 */

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { farmResolution, setFarmResolution } = require('../utils/farmResolution');
const { querySolarDataForPoints } = require('../utils/solarDataGrabber');
const { setTotalPoints, getResults } = require('../utils/solarSuitabilityParser');
const { queryElevationDataForPoints } = require('../utils/elevationDataGrabber');
const { setTotalPoints: setElevationTotalPoints, getResults: getElevationResults } = require('../utils/elevationHeatMapParser');
const { queryClearingCostDataForPoints, getExpectedValues, getAllPricingSnapshots } = require('../utils/clearingCostDataGrabber');

// Validation schema for analyze endpoint
const analyzeFarmSchema = Joi.object({
  coordinates: Joi.array()
    .items(Joi.array().length(2).items(Joi.number()))
    .min(3)
    .required(),
});

// Farm resolution configuration
const FARM_RESOLUTION = 0.0002;
const MAX_GRID_POINTS = 25000;
const DEFAULT_BATCH_SIZE = 100;

function validateCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 3) {
    throw new Error('FAST FAIL: Invalid coordinates - must provide at least 3 points for a valid polygon');
  }

  for (const coord of coordinates) {
    if (!Array.isArray(coord) || coord.length !== 2 ||
        typeof coord[0] !== 'number' || typeof coord[1] !== 'number' ||
        isNaN(coord[0]) || isNaN(coord[1])) {
      throw new Error('FAST FAIL: Invalid coordinate format - each coordinate must be [longitude, latitude] with numeric values');
    }
  }
}

function isLikelyLatLngMichigan(coordinates) {
  const hits = coordinates.filter((coord) => {
    const lat = coord[0];
    const lng = coord[1];
    return lat >= 40 && lat <= 50 && lng >= -90 && lng <= -80;
  });
  return hits.length >= Math.ceil(coordinates.length * 0.75);
}

function closePolygonRing(coordinates) {
  const ring = [...coordinates];
  if (ring.length > 0) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (!last || first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([...first]);
    }
  }
  return ring;
}

function swapCoordinatePairs(coordinates) {
  return coordinates.map(coord => [coord[1], coord[0]]);
}

function reorderPolygon(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 3) {
    return coordinates;
  }

  const base = [...coordinates];
  const first = base[0];
  const last = base[base.length - 1];
  if (last && first && last[0] === first[0] && last[1] === first[1]) {
    base.pop();
  }

  const centroid = base.reduce(
    (acc, coord) => ({
      lng: acc.lng + coord[0],
      lat: acc.lat + coord[1]
    }),
    { lng: 0, lat: 0 }
  );
  centroid.lng /= base.length;
  centroid.lat /= base.length;

  const sorted = base.sort((a, b) => {
    const angleA = Math.atan2(a[1] - centroid.lat, a[0] - centroid.lng);
    const angleB = Math.atan2(b[1] - centroid.lat, b[0] - centroid.lng);
    return angleA - angleB;
  });

  return closePolygonRing(sorted);
}

function computeMedian(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function computeTrimmedMean(values, trimRatio = 0.1) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const trimCount = Math.floor(sorted.length * trimRatio);
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  const target = trimmed.length ? trimmed : sorted;
  const sum = target.reduce((acc, value) => acc + value, 0);
  return sum / target.length;
}

function pointInPolygon(point, polygon) {
  const x = point[0];
  const y = point[1];
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
}

function buildGridPoints(coordinates) {
  validateCoordinates(coordinates);

  const normalizedCoordinates = isLikelyLatLngMichigan(coordinates)
    ? swapCoordinatePairs(coordinates)
    : coordinates;

  if (normalizedCoordinates !== coordinates) {
    console.error('Detected lat,lng input (Michigan heuristic); normalizing to lng,lat.');
  }

  const ring = closePolygonRing(normalizedCoordinates);

  setFarmResolution(FARM_RESOLUTION);

  let gridPoints = farmResolution(ring);
  console.error(`Generated ${gridPoints.length} grid points for analysis`);

  if (gridPoints.length === 0) {
    const reorderedRing = reorderPolygon(coordinates);
    const reorderedGridPoints = farmResolution(reorderedRing);
    if (reorderedGridPoints.length > 0) {
      console.error('No grid points with original order; retrying with angle-sorted polygon.');
      gridPoints = reorderedGridPoints;
      const coordinatePairs = gridPoints.map(point => [point[0], point[1]]);
      return { ring: reorderedRing, gridPoints, coordinatePairs };
    }

    const swapped = swapCoordinatePairs(coordinates);
    const swappedRing = closePolygonRing(swapped);
    const swappedGridPoints = farmResolution(swappedRing);
    if (swappedGridPoints.length > 0) {
      console.error('No grid points with [lng, lat]; retrying with [lat, lng] input order.');
      gridPoints = swappedGridPoints;
      const coordinatePairs = gridPoints.map(point => [point[0], point[1]]);
      return { ring: swappedRing, gridPoints, coordinatePairs };
    }

    const swappedReorderedRing = reorderPolygon(swapped);
    const swappedReorderedGridPoints = farmResolution(swappedReorderedRing);
    if (swappedReorderedGridPoints.length > 0) {
      console.error('No grid points after swap; retrying with swapped angle-sorted polygon.');
      gridPoints = swappedReorderedGridPoints;
      const coordinatePairs = gridPoints.map(point => [point[0], point[1]]);
      return { ring: swappedReorderedRing, gridPoints, coordinatePairs };
    }
  }

  if (gridPoints.length === 0) {
    throw new Error('FAST FAIL: No grid points generated - invalid or degenerate farm boundary');
  }

  if (gridPoints.length > MAX_GRID_POINTS) {
    throw new Error(`FAST FAIL: Too many grid points (${gridPoints.length}) - farm boundary too large for analysis`);
  }

  const coordinatePairs = gridPoints.map(point => [point[0], point[1]]);
  const boundaryPairs = ring.length > 1 ? ring.slice(0, -1) : ring;
  const mergedPairs = [];
  const seen = new Set();

  for (const pair of [...coordinatePairs, ...boundaryPairs]) {
    const key = `${pair[0].toFixed(6)},${pair[1].toFixed(6)}`;
    if (!seen.has(key)) {
      seen.add(key);
      mergedPairs.push(pair);
    }
  }

  return {
    ring,
    gridPoints,
    coordinatePairs: mergedPairs,
    gridPointCount: coordinatePairs.length,
    boundaryPointCount: boundaryPairs.length
  };
}

async function runBatches(coordinatePairs, batchSize, handler) {
  for (let i = 0; i < coordinatePairs.length; i += batchSize) {
    const batch = coordinatePairs.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    console.log(`Processing batch ${batchNumber} with ${batch.length} points`);
    await handler(batch, batchNumber);
  }
}

/**
 * Process farm coordinates and generate solar suitability report
 * @param {Array<Array<number>>} coordinates - Farm boundary coordinates [[lng, lat], ...]
 * @returns {Promise<Object>} Report containing suitability analysis
 */
async function generateSolarReportFromGrid(coordinates, ring, gridPoints, coordinatePairs, counts = {}) {
  try {
    setTotalPoints(0);
    let validPoints = 0;
    let skippedPoints = 0;

    console.error(`Querying solar suitability data for ${coordinatePairs.length} points in batches...`);

    await runBatches(coordinatePairs, DEFAULT_BATCH_SIZE, async (batch, batchNumber) => {
      try {
        const batchResult = await querySolarDataForPoints(batch, { skipNulls: true });
        if (Array.isArray(batchResult)) {
          validPoints += batchResult.length;
        } else {
          validPoints += batchResult.results.length;
          skippedPoints += batchResult.skipped;
        }
      } catch (batchError) {
        throw new Error(`FAST FAIL: Batch processing failed at batch ${batchNumber}: ${batchError.message}`);
      }
    });

    if (validPoints === 0) {
      return {
        success: true,
        metadata: {
          boundaryPoints: coordinates.length,
          gridPoints: gridPoints.length,
          processedPoints: 0,
          validSolarPoints: 0,
          skippedSolarPoints: skippedPoints,
          gridResolution: FARM_RESOLUTION,
          batchSize: DEFAULT_BATCH_SIZE,
          timestamp: new Date().toISOString(),
          warning: 'All solar points were skipped due to missing feature data'
        },
        summary: {
          totalPoints: 0,
          validPoints: 0,
          averageSuitability: 0,
          suitabilityDistribution: {
            excellent: 0,
            good: 0,
            moderate: 0,
            poor: 0,
            unsuitable: 0
          }
        },
        results: []
      };
    }

    const parserResult = getResults();

    console.error(`Processed ${parserResult.results.length} suitability results`);

    if (!parserResult || !parserResult.results || parserResult.results.length === 0) {
      throw new Error('FAST FAIL: No suitability results returned from parser');
    }

    if (parserResult.results.length !== validPoints) {
      throw new Error(`FAST FAIL: Results count mismatch - expected ${validPoints}, got ${parserResult.results.length}`);
    }

    if (parserResult.summary.validPoints === 0) {
      throw new Error('FAST FAIL: No valid suitability scores found in analysis results');
    }

    const overallScores = parserResult.results
      .map((result) => result.overall)
      .filter((value) => Number.isFinite(value));

    const insideScores = parserResult.results
      .map((result, index) => {
        const coord = coordinatePairs[index];
        if (!coord || !Array.isArray(coord) || coord.length !== 2) return null;
        return pointInPolygon(coord, ring) ? result.overall : null;
      })
      .filter((value) => Number.isFinite(value));

    const medianSuitability = computeMedian(overallScores);
    const trimmedMeanSuitability = computeTrimmedMean(overallScores, 0.1);
    const insideMedianSuitability = computeMedian(insideScores);

    return {
      success: true,
      metadata: {
        boundaryPoints: coordinates.length,
        gridPoints: gridPoints.length,
        processedPoints: parserResult.results.length,
        validSolarPoints: validPoints,
        skippedSolarPoints: skippedPoints,
        gridResolution: FARM_RESOLUTION,
        batchSize: DEFAULT_BATCH_SIZE,
        gridPointCount: counts.gridPointCount ?? gridPoints.length,
        boundaryPointCount: counts.boundaryPointCount ?? coordinates.length,
        totalSamplePoints: coordinatePairs.length,
        aggregationMethod: 'median',
        timestamp: new Date().toISOString()
      },
      summary: {
        ...parserResult.summary,
        averageSuitability: Math.round(insideMedianSuitability * 100) / 100,
        medianSuitability: Math.round(medianSuitability * 100) / 100,
        trimmedMeanSuitability: Math.round(trimmedMeanSuitability * 100) / 100
      },
      results: parserResult.results
    };
  } catch (error) {
    console.error('FAST FAIL: Error generating solar report:', error.message);
    return {
      success: false,
      error: error.message,
      metadata: {
        boundaryPoints: coordinates?.length || 0,
        timestamp: new Date().toISOString()
      }
    };
  }
}

async function generateSolarReport(coordinates) {
  try {
    console.log(`Processing farm with ${coordinates.length} boundary points`);
    const { ring, gridPoints, coordinatePairs, gridPointCount, boundaryPointCount } = buildGridPoints(coordinates);
    return await generateSolarReportFromGrid(coordinates, ring, gridPoints, coordinatePairs, { gridPointCount, boundaryPointCount });
  } catch (error) {
    console.error('FAST FAIL: Error generating solar report:', error.message);
    return {
      success: false,
      error: error.message,
      metadata: {
        boundaryPoints: coordinates?.length || 0,
        timestamp: new Date().toISOString()
      }
    };
  }
}

async function generateElevationReportFromGrid(coordinates, gridPoints, coordinatePairs) {
  try {
    setElevationTotalPoints(coordinatePairs.length);

    console.error(`Querying elevation data for ${coordinatePairs.length} points in batches...`);

    await runBatches(coordinatePairs, DEFAULT_BATCH_SIZE, async (batch, batchNumber) => {
      try {
        await queryElevationDataForPoints(batch);
      } catch (batchError) {
        throw new Error(`FAST FAIL: Elevation batch processing failed at batch ${batchNumber}: ${batchError.message}`);
      }
    });

    const parserResult = getElevationResults();

    if (!parserResult || !parserResult.results || parserResult.results.length === 0) {
      throw new Error('FAST FAIL: No elevation results returned from parser');
    }

    if (parserResult.results.length !== coordinatePairs.length) {
      throw new Error(`FAST FAIL: Elevation results count mismatch - expected ${coordinatePairs.length}, got ${parserResult.results.length}`);
    }

    if (parserResult.summary.validPoints === 0) {
      throw new Error('FAST FAIL: No valid elevation scores found in analysis results');
    }

    return {
      success: true,
      metadata: {
        boundaryPoints: coordinates.length,
        gridPoints: gridPoints.length,
        processedPoints: parserResult.results.length,
        timestamp: new Date().toISOString()
      },
      summary: parserResult.summary,
      results: parserResult.results
    };
  } catch (error) {
    console.error('FAST FAIL: Error generating elevation report:', error.message);
    return {
      success: false,
      error: error.message,
      metadata: {
        boundaryPoints: coordinates?.length || 0,
        timestamp: new Date().toISOString()
      }
    };
  }
}

async function generateClearingCostReportFromGrid(coordinates, gridPoints, coordinatePairs, farmAreaAcres) {
  try {
    console.error(`Querying clearing cost data for ${coordinatePairs.length} points in batches...`);

    const clearingData = [];
    const pricingSnapshots = await getAllPricingSnapshots();
    if (!Array.isArray(pricingSnapshots) || pricingSnapshots.length === 0) {
      throw new Error('FAST FAIL: Pricing snapshot missing - pricing_snapshots table has no rows');
    }

    await runBatches(coordinatePairs, DEFAULT_BATCH_SIZE, async (batch, batchNumber) => {
      try {
        const batchResult = await queryClearingCostDataForPoints(batch, { includePricingSnapshots: false });
        if (Array.isArray(batchResult?.clearingData)) {
          clearingData.push(...batchResult.clearingData);
        }
      } catch (batchError) {
        throw new Error(`FAST FAIL: Clearing cost batch processing failed at batch ${batchNumber}: ${batchError.message}`);
      }
    });

    const expectedValues = await getExpectedValues();
    const pricingSnapshot = Array.isArray(pricingSnapshots) && pricingSnapshots.length > 0
      ? pricingSnapshots[0]
      : null;
    const msuRates = pricingSnapshot?.payload?.sources?.msu?.extractedRatesUsdPerAcre || null;
    const mdotItems = pricingSnapshot?.payload?.sources?.mdot?.extractedItems || null;
    if (!msuRates && !mdotItems) {
      throw new Error('FAST FAIL: Pricing snapshot missing MSU and MDOT sources - clearing cost analysis requires live pricing data');
    }
    const equations = {
      vegetationCost: 'vegetation_cost = base_vegetation_cost(nlcd_class) + (is_forest ? expectedTreesPerAcre * 50 : 0)',
      infrastructureCost: 'infrastructure_cost = (buildingCoverage% * 43560 * 25 * demolitionMultiplier) + (roadCoverage% * sqrt(43560) * accessCostPerFt)',
      sitePrepCost: 'site_prep_cost = 500 + max(0, (slope - 10)) * 100 + (waterCoverage% > 0 ? 1000 : 0) + (expectedGradingIntensity * 43560 * expectedCutDepthFt / 27) * gradingCostPerCyd',
      totalCostPerAcre: 'total_cost_per_acre = vegetation_cost + infrastructure_cost + site_prep_cost'
    };

    const dynamicResults = buildDynamicClearingCosts({
      clearingData,
      msuRates,
      mdotItems,
      expectedValues,
      farmAreaAcres
    });
    if (!dynamicResults?.results?.length || !dynamicResults?.summary) {
      throw new Error('FAST FAIL: Dynamic clearing cost model failed to produce results');
    }
    const finalResults = dynamicResults.results;
    const finalSummary = dynamicResults.summary;

    return {
      success: true,
      metadata: {
        boundaryPoints: coordinates.length,
        gridPoints: gridPoints.length,
        processedPoints: finalResults.length,
        pricingSnapshotKey: pricingSnapshot?.snapshotKey || null,
        pricingSnapshotRetrievedAt: pricingSnapshot?.retrievedAt || pricingSnapshot?.payload?.retrievedAt || null,
        timestamp: new Date().toISOString()
      },
      summary: finalSummary,
      results: finalResults,
      equations,
      expectedValues,
      pricingSnapshot: pricingSnapshot
    };
  } catch (error) {
    console.error('FAST FAIL: Error generating clearing cost report:', error.message);
    return {
      success: false,
      error: error.message,
      metadata: {
        boundaryPoints: coordinates?.length || 0,
        timestamp: new Date().toISOString()
      }
    };
  }
}

/**
 * Get farm area estimate from boundary coordinates
 * @param {Array<Array<number>>} coordinates - Farm boundary coordinates
 * @returns {number} Area in acres
 */
function calculateFarmArea(coordinates) {
  if (!coordinates || coordinates.length < 3) return 0;

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
  return Math.round(acres * 100) / 100;
}

const NLCD_GROUP_BY_CLASS = {
  11: 'water',
  21: 'developed',
  22: 'developed',
  23: 'developed',
  24: 'developed',
  31: 'barren',
  41: 'forest',
  42: 'forest',
  43: 'forest',
  52: 'shrub',
  71: 'grass',
  81: 'ag',
  82: 'ag',
  90: 'wetlands',
  95: 'wetlands',
};

const MODEL_ASSUMPTIONS = {
  treesPerAcre: 50,
  stumpsPerTree: 1,
  imperviousRemovalFraction: 0.5,
  earthworkCutDepthFt: 0.5,
  baseSitePrepCost: 500,
  waterSurcharge: 1000,
  expectedGradingIntensity: 0.1,
  expectedCutDepthFt: 2,
};

const LANDCOVER_PROBABILITY_WEIGHTS = {
  11: { treeCoverageFactor: 0.0, developmentIntensity: 0.0, vegetationRateFactor: 0.0 },
  21: { treeCoverageFactor: 0.1, developmentIntensity: 1.0, vegetationRateFactor: 0.4 },
  22: { treeCoverageFactor: 0.15, developmentIntensity: 0.7, vegetationRateFactor: 0.5 },
  23: { treeCoverageFactor: 0.2, developmentIntensity: 0.4, vegetationRateFactor: 0.6 },
  24: { treeCoverageFactor: 0.25, developmentIntensity: 0.2, vegetationRateFactor: 0.7 },
  31: { treeCoverageFactor: 0.05, developmentIntensity: 0.1, vegetationRateFactor: 0.8 },
  41: { treeCoverageFactor: 1.0, developmentIntensity: 0.1, vegetationRateFactor: 1.0 },
  42: { treeCoverageFactor: 1.0, developmentIntensity: 0.1, vegetationRateFactor: 1.0 },
  43: { treeCoverageFactor: 1.0, developmentIntensity: 0.1, vegetationRateFactor: 1.0 },
  52: { treeCoverageFactor: 0.4, developmentIntensity: 0.1, vegetationRateFactor: 0.9 },
  71: { treeCoverageFactor: 0.1, developmentIntensity: 0.05, vegetationRateFactor: 1.0 },
  81: { treeCoverageFactor: 0.05, developmentIntensity: 0.05, vegetationRateFactor: 1.0 },
  82: { treeCoverageFactor: 0.05, developmentIntensity: 0.05, vegetationRateFactor: 1.0 },
  90: { treeCoverageFactor: 0.7, developmentIntensity: 0.05, vegetationRateFactor: 0.8 },
  95: { treeCoverageFactor: 0.5, developmentIntensity: 0.05, vegetationRateFactor: 0.8 },
};

function getLandcoverWeights(nlcdValue, group) {
  if (Number.isFinite(nlcdValue) && LANDCOVER_PROBABILITY_WEIGHTS[nlcdValue]) {
    return LANDCOVER_PROBABILITY_WEIGHTS[nlcdValue];
  }
  if (group === 'developed') {
    return { treeCoverageFactor: 0.2, developmentIntensity: 0.4, vegetationRateFactor: 0.6 };
  }
  if (group === 'forest') {
    return { treeCoverageFactor: 1.0, developmentIntensity: 0.1, vegetationRateFactor: 1.0 };
  }
  if (group === 'wetlands') {
    return { treeCoverageFactor: 0.7, developmentIntensity: 0.05, vegetationRateFactor: 0.8 };
  }
  return { treeCoverageFactor: 0.1, developmentIntensity: 0.05, vegetationRateFactor: 0.8 };
}

const MSU_RATE_KEYWORDS = {
  ag: ['disk', 'till', 'plow', 'cultivator'],
  grass: ['mow', 'mower', 'shred', 'rotary', 'brush'],
  shrub: ['mow', 'mower', 'shred', 'rotary', 'brush'],
  barren: ['disk', 'till', 'plow', 'cultivator'],
  unknown: ['mow', 'mower', 'shred', 'rotary', 'brush'],
};

function pickMsuRate(msuRates, keywords) {
  if (!msuRates || typeof msuRates !== 'object') return null;
  const entries = Object.entries(msuRates);
  if (entries.length === 0) return null;

  const lowerKeywords = Array.isArray(keywords) ? keywords.map((k) => k.toLowerCase()) : [];
  const match = entries.find(([key]) =>
    lowerKeywords.some((kw) => key.toLowerCase().includes(kw))
  );

  const value = match ? match[1] : entries[0][1];
  return Number.isFinite(value) ? value : null;
}

function getMdotItemPrice(mdotItems, key) {
  if (!mdotItems || typeof mdotItems !== 'object') return null;
  const item = mdotItems[key];
  const value = item?.avgAwardPriceUsd ?? item?.avgAwardPrice ?? null;
  return Number.isFinite(value) ? value : null;
}

function buildDynamicClearingCosts({ clearingData, msuRates, mdotItems, expectedValues, farmAreaAcres }) {
  if (!Array.isArray(clearingData) || clearingData.length === 0) return null;
  if (!msuRates && !mdotItems) return null;

  const results = [];
  const totals = [];

  const treeRemovalPrice = getMdotItemPrice(mdotItems, 'treeRemoval6to18');
  const stumpRemovalPrice = getMdotItemPrice(mdotItems, 'stumpRemoval6to18');
  const clearingAndGrubbingPrice = getMdotItemPrice(mdotItems, 'clearingAndGrubbing');
  const pavementRemovalPrice = getMdotItemPrice(mdotItems, 'pavementRemoval');
  const concreteRemovalSydPrice = getMdotItemPrice(mdotItems, 'concreteRemovalSyd');
  const concreteRemovalSftPrice = getMdotItemPrice(mdotItems, 'concreteRemovalSft');
  const earthExcavationPrice = getMdotItemPrice(mdotItems, 'earthExcavation');

  clearingData.forEach((point) => {
    const nlcdValue = Number.isFinite(point?.nlcd_value) ? point.nlcd_value : null;
    const group = nlcdValue !== null ? (NLCD_GROUP_BY_CLASS[nlcdValue] || 'unknown') : 'unknown';
    const weights = getLandcoverWeights(nlcdValue, group);

    const buildingCoverage = Number.isFinite(point?.building_coverage) ? point.building_coverage : 0;
    const roadCoverage = Number.isFinite(point?.road_coverage) ? point.road_coverage : 0;
    const waterCoverage = Number.isFinite(point?.water_coverage) ? point.water_coverage : 0;
    const slopeValue = Number.isFinite(point?.slope_value) ? point.slope_value : null;
    const developedFraction = Math.min(1, Math.max(0, (buildingCoverage + roadCoverage) / 100));

    let vegetationCost = 0;
    let infrastructureCost = 0;

    if (group === 'forest' || group === 'wetlands' || group === 'shrub') {
      const treesPerAcre = expectedValues?.expectedTreesPerAcre ?? MODEL_ASSUMPTIONS.treesPerAcre;
      const stumpsPerTree = MODEL_ASSUMPTIONS.stumpsPerTree;
      const treesPerAcreScaled = treesPerAcre * weights.treeCoverageFactor;
      if (treeRemovalPrice) vegetationCost += treeRemovalPrice * treesPerAcreScaled;
      if (stumpRemovalPrice) vegetationCost += stumpRemovalPrice * treesPerAcreScaled * stumpsPerTree;
    } else if (group !== 'water') {
      const msuRate = pickMsuRate(msuRates, MSU_RATE_KEYWORDS[group] || MSU_RATE_KEYWORDS.unknown);
      if (msuRate) vegetationCost += msuRate * weights.vegetationRateFactor;
    }

    const imperviousRemovalFraction = MODEL_ASSUMPTIONS.imperviousRemovalFraction;
    const earthworkCutDepthFt = MODEL_ASSUMPTIONS.earthworkCutDepthFt;
    const areaAcre = 1;
    const clearingQty = areaAcre;
    const pavementQty = areaAcre * 4840 * imperviousRemovalFraction;
    const concreteSydQty = areaAcre * 4840 * (imperviousRemovalFraction / 2);
    const concreteSftQty = areaAcre * 43560 * (imperviousRemovalFraction / 2);
    const earthQty = areaAcre * 1613.3333333333 * earthworkCutDepthFt;

    let infrastructureBase = 0;
    if (clearingAndGrubbingPrice) infrastructureBase += clearingAndGrubbingPrice * clearingQty;
    if (pavementRemovalPrice) infrastructureBase += pavementRemovalPrice * pavementQty;
    if (concreteRemovalSydPrice) {
      infrastructureBase += concreteRemovalSydPrice * concreteSydQty;
    } else if (concreteRemovalSftPrice) {
      infrastructureBase += concreteRemovalSftPrice * concreteSftQty;
    }
    if (earthExcavationPrice) infrastructureBase += earthExcavationPrice * earthQty;

    const developmentScale = developedFraction * weights.developmentIntensity;
    if (developmentScale > 0) {
      infrastructureCost += infrastructureBase * developmentScale;
    }

    const gradingCostPerCyd = earthExcavationPrice || 0;
    const expectedGradingIntensity = expectedValues?.expectedGradingIntensity ?? MODEL_ASSUMPTIONS.expectedGradingIntensity;
    const expectedCutDepthFt = expectedValues?.expectedCutDepthFt ?? MODEL_ASSUMPTIONS.expectedCutDepthFt;
    const gradingVolumeCyd = (expectedGradingIntensity * 43560 * expectedCutDepthFt) / 27;
    const slopePenalty = Number.isFinite(slopeValue) && slopeValue > 10
      ? (slopeValue - 10) * 100
      : 0;
    const sitePrepCost =
      MODEL_ASSUMPTIONS.baseSitePrepCost +
      slopePenalty +
      (waterCoverage > 0 ? MODEL_ASSUMPTIONS.waterSurcharge : 0) +
      gradingCostPerCyd * gradingVolumeCyd;

    const totalCostPerAcre = vegetationCost + infrastructureCost + sitePrepCost;

    results.push({
      lng: point?.lng,
      lat: point?.lat,
      slope_value: slopeValue,
      total_cost_per_acre: totalCostPerAcre,
      site_prep_cost: sitePrepCost,
      infrastructure_cost: infrastructureCost,
      vegetation_cost: vegetationCost,
      confidence_level: 1,
      nlcd_value: nlcdValue,
      landcover_group: group,
    });

    totals.push(totalCostPerAcre);
  });

  const avgCost = totals.length ? totals.reduce((sum, v) => sum + v, 0) / totals.length : 0;
  const minCost = totals.length ? Math.min(...totals) : 0;
  const maxCost = totals.length ? Math.max(...totals) : 0;

  const lowThreshold = minCost + (maxCost - minCost) / 3;
  const highThreshold = minCost + ((maxCost - minCost) * 2) / 3;

  let lowCostAreas = 0;
  let mediumCostAreas = 0;
  let highCostAreas = 0;

  totals.forEach((value) => {
    if (value <= lowThreshold) lowCostAreas += 1;
    else if (value <= highThreshold) mediumCostAreas += 1;
    else highCostAreas += 1;
  });

  const totalEstimatedCost = Number.isFinite(farmAreaAcres)
    ? avgCost * farmAreaAcres
    : avgCost * results.length;

  return {
    summary: {
      totalPoints: results.length,
      validPoints: results.length,
      averageCostPerAcre: avgCost,
      totalEstimatedCost,
      minCostPerAcre: minCost,
      maxCostPerAcre: maxCost,
      highCostAreas,
      mediumCostAreas,
      lowCostAreas,
    },
    results,
  };
}

// POST /api/reports/analyze
// Analyze solar suitability for farm coordinates
router.post('/analyze', async (req, res, next) => {
  try {
    const startTime = Date.now();

    // Fast fail: Validate request immediately
    const { error, value } = analyzeFarmSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'FAST FAIL: Validation Error',
        message: error.details[0].message,
        timestamp: new Date().toISOString()
      });
    }

    const { coordinates } = value;

    // Fast fail: Calculate area and check farm size limit
    const farmAreaAcres = calculateFarmArea(coordinates);
    const MAX_FARM_ACRES = 1000;

    if (farmAreaAcres > MAX_FARM_ACRES) {
      return res.status(400).json({
        success: false,
        error: 'FAST FAIL: Farm Too Large',
        message: `Farm area of ${farmAreaAcres.toFixed(1)} acres exceeds the maximum allowed size of ${MAX_FARM_ACRES} acres. Please break your farm into smaller sections and analyze them separately.`,
        farmArea: farmAreaAcres,
        maxAllowedArea: MAX_FARM_ACRES,
        timestamp: new Date().toISOString()
      });
    }

    // Generate shared grid once for all parsers
    const { ring, gridPoints, coordinatePairs, gridPointCount, boundaryPointCount } = buildGridPoints(coordinates);

    // Run solar suitability analysis
    const solarReport = await generateSolarReportFromGrid(coordinates, ring, gridPoints, coordinatePairs, { gridPointCount, boundaryPointCount });
    if (!solarReport.success) {
      return res.status(500).json({
        success: false,
        error: 'FAST FAIL: Solar Analysis Failed',
        message: solarReport.error,
        metadata: solarReport.metadata
      });
    }

    // Run elevation heatmap analysis
    const elevationReport = await generateElevationReportFromGrid(coordinates, gridPoints, coordinatePairs);
    if (!elevationReport.success) {
      return res.status(500).json({
        success: false,
        error: 'FAST FAIL: Elevation Analysis Failed',
        message: elevationReport.error,
        metadata: elevationReport.metadata
      });
    }

    // Run clearing cost analysis
    const clearingCostReport = await generateClearingCostReportFromGrid(
      coordinates,
      gridPoints,
      coordinatePairs,
      farmAreaAcres
    );
    if (!clearingCostReport.success) {
      return res.status(500).json({
        success: false,
        error: 'FAST FAIL: Clearing Cost Analysis Failed',
        message: clearingCostReport.error,
        metadata: clearingCostReport.metadata
      });
    }

    const processingTimeMs = Date.now() - startTime;

    // Return the report with organized sections
    const responsePayload = {
      success: true,
      metadata: {
        grid: {
          resolution: FARM_RESOLUTION,
          gridPoints,
          gridPointCount,
          boundaryPoints: Array.isArray(ring) ? ring : coordinates,
          boundaryPointCount,
        },
        ...solarReport.metadata,
        processingTimeMs,
        farmAreaAcres: Math.round(farmAreaAcres * 100) / 100
      },
      solarSuitability: {
        summary: solarReport.summary,
        results: solarReport.results,
        metadata: solarReport.metadata
      },
      elevation: {
        summary: elevationReport.summary,
        results: elevationReport.results,
        metadata: elevationReport.metadata
      },
      clearingCost: {
        summary: clearingCostReport.summary,
        results: clearingCostReport.results,
        equations: clearingCostReport.equations,
        expectedValues: clearingCostReport.expectedValues,
        metadata: clearingCostReport.metadata
      }
    };

    res.set('Content-Type', 'application/json');
    res.send(JSON.stringify(responsePayload, null, 2));

  } catch (error) {
    console.error('FAST FAIL: Unexpected error in analyze endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'FAST FAIL: Internal Server Error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/reports/health
// Health check for reports service
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'reports',
    timestamp: new Date().toISOString(),
  });
});

module.exports = {
  generateSolarReport,
  calculateFarmArea,
  router
};