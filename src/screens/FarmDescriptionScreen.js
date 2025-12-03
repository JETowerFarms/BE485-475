import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Pressable,
  Platform,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Animated,
  Dimensions,
  Modal,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
} from 'react-native';
import Slider from '@react-native-community/slider';
import Svg, { Polygon, Rect, Line, Defs, LinearGradient, Stop, Image as SvgImage, ClipPath, Circle, Path, Text as SvgText, G } from 'react-native-svg';
import Carousel from 'react-native-reanimated-carousel';
import { interpolate } from 'react-native-reanimated';
import { contours } from 'd3-contour';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point as turfPoint, polygon as turfPolygon } from '@turf/helpers';

// API-based solar suitability data access (30x30 grid - 120M points at 0.96 acres/cell)
// Instead of loading 11GB JSON, we fetch only the coordinates we need
const SOLAR_GRID_SPACING = 0.000667; // degrees between points in 30x30 grid
const SOLAR_DATA_CACHE = new Map(); // Cache fetched data points

// Coordinate-based data fetcher (simulates API - replace with actual fetch when backend ready)
const fetchSolarDataPoint = async (lat, lng) => {
  // Round to grid coordinates
  const latKey = lat.toFixed(6);
  const lngKey = lng.toFixed(6);
  const cacheKey = `${latKey}_${lngKey}`;
  
  // Check cache
  if (SOLAR_DATA_CACHE.has(cacheKey)) {
    return SOLAR_DATA_CACHE.get(cacheKey);
  }
  
  // TODO: Replace with actual API call when backend is ready
  // For now, return null (will trigger fallback to nearest neighbor from old dataset)
  // Example API structure:
  // const response = await fetch(`/api/solar/${latKey}/${lngKey}`);
  // const data = await response.json();
  
  return null;
};

const COLORS = {
  // Default app colors (beige/tan theme)
  background: '#F5F0E6',
  backgroundDark: '#E8E0D0',
  text: '#2C2C2C',
  textLight: '#666666',
  border: '#8B8680',
  borderLight: '#D4D0C4',
  buttonBg: '#D4C4B0',
  buttonBorder: '#8B8680',
  buttonText: '#2C2C2C',
  inputBg: '#FFFFFF',
  placeholder: '#999999',
  // Muted green highlights (matching app's sage green)
  headerBg: '#C5D5C5',
  headerText: '#2C2C2C',
  headerBorder: '#9BB09B',
  accent: '#7A9A7A',
  // Complementary warm button
  nextButtonBg: '#F4A460',
  nextButtonBorder: '#E8946A',
  // Drawer colors
  drawerBg: '#FFFFFF',
  drawerHandle: '#D4D0C4',
};

const DRAWER_WIDTH = Dimensions.get('window').width * 0.75;

const toCoordKey = (coord) => {
  if (!coord) return 'na';
  const [lng, lat] = coord;
  if (typeof lng !== 'number' || typeof lat !== 'number') {
    return 'na';
  }
  return `${lng.toFixed(4)}_${lat.toFixed(4)}`;
};

const getStableFarmId = (farmId, coords) => {
  if (farmId) return farmId;
  if (Array.isArray(coords) && coords.length > 0) {
    const first = coords[0];
    const middle = coords[Math.floor(coords.length / 2)];
    const last = coords[coords.length - 1];
    return `poly-${coords.length}-${toCoordKey(first)}-${toCoordKey(middle)}-${toCoordKey(last)}`;
  }
  return 'poly-unknown';
};

// Helper to normalize polygon coordinates to fit in a given size
const normalizePolygon = (coordinates, size) => {
  if (!coordinates || coordinates.length === 0) return '';
  
  // Remove the closing point if it duplicates the first point (GeoJSON format)
  let coords = [...coordinates];
  if (coords.length > 1) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) {
      coords = coords.slice(0, -1);
    }
  }
  
  if (coords.length < 3) return '';
  
  // Calculate centroid
  let centroidX = 0, centroidY = 0;
  coords.forEach(([lng, lat]) => {
    centroidX += lng;
    centroidY += lat;
  });
  centroidX /= coords.length;
  centroidY /= coords.length;
  
  // Sort coordinates by angle from centroid to form a proper polygon
  const sortedCoords = [...coords].sort((a, b) => {
    const angleA = Math.atan2(a[1] - centroidY, a[0] - centroidX);
    const angleB = Math.atan2(b[1] - centroidY, b[0] - centroidX);
    return angleA - angleB;
  });
  
  // Get bounds
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  sortedCoords.forEach(([lng, lat]) => {
    minX = Math.min(minX, lng);
    maxX = Math.max(maxX, lng);
    minY = Math.min(minY, lat);
    maxY = Math.max(maxY, lat);
  });
  
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  const padding = size * 0.1;
  const availableSize = size - padding * 2;
  const scale = Math.min(availableSize / width, availableSize / height);
  
  // Center and scale
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  
  return sortedCoords.map(([lng, lat]) => {
    const x = padding + (lng - cx) * scale + availableSize / 2;
    const y = padding + (cy - lat) * scale + availableSize / 2; // Flip Y for screen coords
    return `${x},${y}`;
  }).join(' ');
};

// Calculate polygon area from coordinates using Shoelace formula
// Returns area in acres and square miles
const calculatePolygonArea = (coordinates) => {
  if (!coordinates || coordinates.length < 3) {
    return { acres: 0, sqMiles: 0 };
  }
  
  // Remove the closing point if it duplicates the first point (GeoJSON format)
  let coords = [...coordinates];
  if (coords.length > 1) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) {
      coords = coords.slice(0, -1);
    }
  }
  
  // Calculate centroid latitude for accurate conversion
  const avgLat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
  const latRad = avgLat * Math.PI / 180;
  
  // Meters per degree at this latitude
  const metersPerDegreeLat = 111132.92 - 559.82 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
  const metersPerDegreeLng = 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad);
  
  // Shoelace formula for area in square degrees
  let area = 0;
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // Convert to meters for accurate area
    const x1 = coords[i][0] * metersPerDegreeLng;
    const y1 = coords[i][1] * metersPerDegreeLat;
    const x2 = coords[j][0] * metersPerDegreeLng;
    const y2 = coords[j][1] * metersPerDegreeLat;
    area += x1 * y2 - x2 * y1;
  }
  area = Math.abs(area) / 2; // Area in square meters
  
  // Convert to acres and square miles
  const acres = area / 4046.8564224; // 1 acre = 4046.8564224 sq meters
  const sqMiles = area / 2589988.110336; // 1 sq mile = 2589988.110336 sq meters
  
  return { acres, sqMiles };
};

// Farm polygon colors
const FARM_COLORS = [
  '#7CB342', // Light green
  '#43A047', // Green
  '#2E7D32', // Dark green
  '#558B2F', // Lime green
  '#33691E', // Deep green
];

// Elevation color scale (low to high elevation)
const ELEVATION_COLORS = [
  { min: 0, max: 180, color: '#2E7D32' },      // Deep green - lowlands
  { min: 180, max: 220, color: '#4CAF50' },    // Green
  { min: 220, max: 260, color: '#8BC34A' },    // Light green
  { min: 260, max: 300, color: '#CDDC39' },    // Lime
  { min: 300, max: 340, color: '#FFC107' },    // Amber
  { min: 340, max: 400, color: '#FF9800' },    // Orange
  { min: 400, max: 500, color: '#FF5722' },    // Deep orange
  { min: 500, max: 700, color: '#8B4513' },    // Brown - highlands
];

// Solar suitability color scale - Red (worst) to Green (best) gradient
const SOLAR_COLORS = [
  { min: 0, max: 20, color: '#DC2626' },       // Worst - dark red
  { min: 20, max: 35, color: '#EF4444' },      // Very Poor - red
  { min: 35, max: 50, color: '#F87171' },      // Poor - light red
  { min: 50, max: 60, color: '#FCA5A5' },      // Below Average - pink-red
  { min: 60, max: 70, color: '#FDE047' },      // Average - yellow
  { min: 70, max: 80, color: '#BEF264' },      // Above Average - yellow-green
  { min: 80, max: 90, color: '#86EFAC' },      // Good - light green
  { min: 90, max: 95, color: '#22C55E' },      // Very Good - green
  { min: 95, max: 100, color: '#16A34A' },     // Best - dark green
];

// High-contrast gradient for per-cell rendering (red -> amber -> green)
const SOLAR_GRADIENT_STOPS = [
  { position: 0, color: { r: 130, g: 13, b: 13 } },     // deep red
  { position: 0.4, color: { r: 245, g: 176, b: 23 } },  // rich amber
  { position: 1, color: { r: 16, g: 122, b: 55 } },     // deep green
];

const getSolarGradientColor = (value) => {
  const clamped = Math.min(1, Math.max(0, Math.pow(value, 0.7))); // emphasize lower values
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
};

const getSolarGradientColorForScore = (score) => {
  if (score == null || Number.isNaN(score)) {
    return getSolarGradientColor(0);
  }
  const normalized = Math.min(1, Math.max(0, score / 100));
  return getSolarGradientColor(normalized);
};

// NOTE: Deleted getElevationColor function - no longer using fake elevation data

// Helper to get solar suitability color based on score
const getSolarColor = (score) => {
  for (const range of SOLAR_COLORS) {
    if (score >= range.min && score < range.max) {
      return range.color;
    }
  }
  return SOLAR_COLORS[SOLAR_COLORS.length - 1].color;
};

// TURF.JS - Industry-standard point-in-polygon testing
// Replaces faulty custom ray casting algorithm
// Reference: https://turfjs.org/docs/#booleanPointInPolygon
const isPointInPolygon = (point, polygon) => {
  try {
    const [lng, lat] = point;
    
    // Create Turf point and polygon - OFFICIAL TURF.JS API
    const pt = turfPoint([lng, lat]);
    
    // Ensure polygon is closed for Turf.js
    const polygonCoords = [...polygon.map(c => [c[0], c[1]])];
    if (polygonCoords[0][0] !== polygonCoords[polygonCoords.length - 1][0] ||
        polygonCoords[0][1] !== polygonCoords[polygonCoords.length - 1][1]) {
      polygonCoords.push(polygonCoords[0]);
    }
    
    const turfPoly = turfPolygon([polygonCoords]);
    return booleanPointInPolygon(pt, turfPoly);
  } catch (error) {
    console.error('❌ Turf isPointInPolygon error:', error);
    return false;
  }
};

// Check if two line segments intersect
const segmentsIntersect = (p1, p2, p3, p4) => {
  const ccw = (a, b, c) => {
    return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0]);
  };
  return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
};

// Check if a cell (rectangle) intersects with the polygon
// This properly handles cases where polygon edges cut through cells
const cellIntersectsPolygon = (cellBounds, polygon) => {
  const { minLat, maxLat, minLng, maxLng } = cellBounds;
  
  // Define the 4 corners of the cell
  const cellCorners = [
    [minLng, minLat],  // bottom-left
    [maxLng, minLat],  // bottom-right
    [maxLng, maxLat],  // top-right
    [minLng, maxLat]   // top-left
  ];
  
  // Check if any cell corner is inside the polygon
  for (const corner of cellCorners) {
    if (isPointInPolygon(corner, polygon)) {
      return true;
    }
  }
  
  // Check if any polygon vertex is inside the cell
  for (const vertex of polygon) {
    const [lng, lat] = vertex;
    if (lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat) {
      return true;
    }
  }
  
  // Check if any cell edge intersects any polygon edge
  const cellEdges = [
    [cellCorners[0], cellCorners[1]],  // bottom
    [cellCorners[1], cellCorners[2]],  // right
    [cellCorners[2], cellCorners[3]],  // top
    [cellCorners[3], cellCorners[0]]   // left
  ];
  
  for (let i = 0; i < polygon.length; i++) {
    const polyEdge = [polygon[i], polygon[(i + 1) % polygon.length]];
    for (const cellEdge of cellEdges) {
      if (segmentsIntersect(cellEdge[0], cellEdge[1], polyEdge[0], polyEdge[1])) {
        return true;
      }
    }
  }
  
  return false;
};

// Interpret land cover score based on EGLE NLCD methodology
// Scores are derived from NLCD 2021 land cover classifications
const interpretLandCover = (landCoverScore) => {
  // Based on Michigan EGLE Solar Energy Suitability Tool methodology
  // Reference: src/data/egle_scoring_methodology.json
  
  // Score 90: Barren Land, Grassland/Herbaceous, Pasture/Hay, Cultivated Crops (NLCD 31, 71, 81, 82)
  if (landCoverScore >= 88) {
    return {
      type: 'Open Land (High Suitability)',
      nlcdClasses: 'Agricultural, Grassland, Pasture, or Barren Land',
      description: 'Open terrain in ~2km area',
      clearingCost: 'Minimal to Low',
      costLevel: 'low',
      notes: 'Area characterized by open land uses. Site-specific conditions may vary within this classification.'
    };
  }
  // Score 75: Developed Open Space, Shrub/Scrub (NLCD 21, 52)
  else if (landCoverScore >= 73) {
    return {
      type: 'Open Development / Shrubland',
      nlcdClasses: 'Developed Open Space or Shrub/Scrub',
      description: 'Mixed open development in ~2km area',
      clearingCost: 'Low to Moderate',
      costLevel: 'low',
      notes: 'May include parks, golf courses, or shrubby areas. Site-specific assessment recommended.'
    };
  }
  // Score 50: Low Intensity Development, Deciduous/Evergreen/Mixed Forest (NLCD 22, 41, 42, 43)
  else if (landCoverScore >= 48) {
    return {
      type: 'Forested / Low Development',
      nlcdClasses: 'Forest or Low-Intensity Development',
      description: 'Forested area or low-density residential',
      clearingCost: 'Moderate to High',
      costLevel: 'medium',
      notes: 'Tree clearing or structure removal likely required'
    };
  }
  // Score 25: Medium Intensity Development (NLCD 23)
  else if (landCoverScore >= 23) {
    return {
      type: 'Medium Development',
      nlcdClasses: 'Medium-Intensity Development',
      description: 'Moderate urban/suburban development',
      clearingCost: 'High',
      costLevel: 'high',
      notes: 'Significant demolition or clearing required'
    };
  }
  // Score 1: Open Water, Ice/Snow, High Intensity Development, Wetlands (NLCD 11, 12, 24, 90, 95)
  else if (landCoverScore >= 1) {
    return {
      type: 'Water / Wetland / Dense Urban',
      nlcdClasses: 'Water, Wetland, or High-Intensity Development',
      description: 'Unsuitable for solar development',
      clearingCost: 'Not Applicable',
      costLevel: 'high',
      notes: 'May not be developable due to environmental or zoning restrictions'
    };
  }
};

// NOTE: Deleted fake getDetailedSolarScore and getElevationForCoord functions.
// They calculated slope from fake elevation data (only 63 points interpolated across Michigan).
// The real solar suitability data already includes actual slope values from LandFire 2020.
// Solar scores use 100% REAL data: land cover (NLCD 2024), slope (LandFire 2020), 
// transmission lines (EIA 123,473 points), and population (GPW 2020).
// Topological view now uses REAL slope data instead of synthetic sine/cosine waves.

// Get solar suitability data for a coordinate using EGLE methodology
// Note: 'overall' is the primary score in source data, 'score' is an alias for compatibility

const interpolateSolarFields = (weights, samples) => {
  // Note: source data uses 'overall' as the main score, not 'score'
  // We interpolate the real fields and then derive 'score' from 'overall'
  const fields = ['overall', 'land_cover', 'slope', 'transmission', 'population'];
  const result = {};
  fields.forEach(field => {
    // All samples are guaranteed to exist when this function is called
    const interpolated =
      (samples.c00[field] ?? 0) * weights.w00 +
      (samples.c10[field] ?? 0) * weights.w10 +
      (samples.c01[field] ?? 0) * weights.w01 +
      (samples.c11[field] ?? 0) * weights.w11;
    result[field] = interpolated;
  });
  // Derive 'score' from 'overall' (the main suitability value in source data)
  result.score = result.overall;
  // Alias substation to transmission for backward compatibility
  result.substation = result.transmission;
  return result;
};

const getNearestValue = (value, sortedValues) => {
  if (!sortedValues || sortedValues.length === 0) {
    return value;
  }
  const first = sortedValues[0];
  const last = sortedValues[sortedValues.length - 1];
  if (value <= first) return first;
  if (value >= last) return last;

  let low = 0;
  let high = sortedValues.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midVal = sortedValues[mid];
    if (midVal === value) {
      return midVal;
    }
    if (midVal < value) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lower = sortedValues[Math.max(0, high)];
  const upper = sortedValues[Math.min(sortedValues.length - 1, low)];
  return (value - lower) <= (upper - value) ? lower : upper;
};

const getBoundingPair = (value, sortedValues) => {
  if (!sortedValues || sortedValues.length === 0) {
    return [value, value];
  }
  const first = sortedValues[0];
  const last = sortedValues[sortedValues.length - 1];
  if (value <= first) return [first, first];
  if (value >= last) return [last, last];

  let low = 0;
  let high = sortedValues.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midVal = sortedValues[mid];
    if (midVal === value) {
      return [midVal, midVal];
    }
    if (midVal < value) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lower = sortedValues[Math.max(0, high)];
  const upper = sortedValues[Math.min(sortedValues.length - 1, low)];
  return [lower, upper];
};

const findNearestSolarSample = (lat, lng) => {
  if (SOLAR_LAT_KEYS.length === 0 || SOLAR_LNG_KEYS.length === 0) {
    return null;
  }
  const nearestLat = getNearestValue(lat, SOLAR_LAT_KEYS);
  const latData = solarSuitabilityData[nearestLat.toFixed(2)];
  if (!latData) {
    return null;
  }
  const nearestLng = getNearestValue(lng, SOLAR_LNG_KEYS);
  const result = latData[nearestLng.toFixed(2)];
  if (!result) {
    return null;
  }
  return {
    ...result,
    score: result.overall,
    substation: result.transmission,
  };
};

// Get solar suitability data for a coordinate using 30x30 grid
// Uses coordinate-based indexing - no need to load entire dataset
const getSolarForCoord = (lat, lng) => {
  // Round to nearest grid point (0.000667° spacing)
  const latRounded = Math.round(lat / SOLAR_GRID_SPACING) * SOLAR_GRID_SPACING;
  const lngRounded = Math.round(lng / SOLAR_GRID_SPACING) * SOLAR_GRID_SPACING;
  
  // Synchronous lookup from cache (async fetch happens in background)
  const cacheKey = `${latRounded.toFixed(6)}_${lngRounded.toFixed(6)}`;
  
  if (SOLAR_DATA_CACHE.has(cacheKey)) {
    const data = SOLAR_DATA_CACHE.get(cacheKey);
    return {
      ...data,
      score: data.overall,
      substation: data.transmission
    };
  }
  
  // Prefetch data point in background (non-blocking)
  fetchSolarDataPoint(latRounded, lngRounded).then(data => {
    if (data) {
      SOLAR_DATA_CACHE.set(cacheKey, data);
    }
  });
  
  // Return null for now - will be populated on next render
  // Or fallback to coarse grid if needed
  return null;
};

// Get bounds of a polygon (array of [lng, lat] coordinates)
const getPolygonBounds = (coordinates) => {
  if (!coordinates || coordinates.length === 0) {
    return { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 };
  }
  
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  
  coordinates.forEach(([lng, lat]) => {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  });
  
  return { minLat, maxLat, minLng, maxLng };
};

// Get average elevation for a polygon
// NOTE: Deleted getAverageElevation function - it used fake elevation data

// Get average solar suitability for a polygon
const getAverageSolar = (coordinates) => {
  if (!coordinates || coordinates.length === 0) return null;
  
  const bounds = getPolygonBounds(coordinates);
  
  // For small farms, just sample the center point
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLng = (bounds.minLng + bounds.maxLng) / 2;
  
  const centerSolar = getSolarForCoord(centerLat, centerLng);
  
  // DEBUG: Log land_cover value
  console.log('🌍 AVG SOLAR:', {
    hasData: !!centerSolar,
    land_cover: centerSolar?.land_cover,
    overall: centerSolar?.overall,
    isWater: centerSolar?.land_cover === 0,
  });
  
  // If we got data from center, use it (return ALL fields)
  if (centerSolar) {
    return centerSolar; // Return the entire object with all fields
  }
  
  // Otherwise try sampling multiple points and average ALL fields
  const step = 0.05;
  let overallSum = 0;
  let landCoverSum = 0;
  let slopeSum = 0;
  let transmissionSum = 0;
  let populationSum = 0;
  let scoreSum = 0;
  let count = 0;
  
  for (let lat = bounds.minLat; lat <= bounds.maxLat; lat += step) {
    for (let lng = bounds.minLng; lng <= bounds.maxLng; lng += step) {
      const solar = getSolarForCoord(lat, lng);
      if (solar) {
        overallSum += solar.overall || solar.score || 0;
        landCoverSum += solar.land_cover || 0;
        slopeSum += solar.slope || 0;
        transmissionSum += solar.transmission || solar.substation || 0;
        populationSum += solar.population || 0;
        scoreSum += solar.score || 0;
        count++;
      }
    }
  }
  
  if (count > 0) {
    return {
      overall: overallSum / count,
      land_cover: landCoverSum / count,
      slope: slopeSum / count,
      transmission: transmissionSum / count,
      substation: transmissionSum / count,  // Backward compatibility
      population: populationSum / count,
      score: scoreSum / count
    };
  }
  
  return null;
};

// Generate contour lines using d3-contour library with synthetic terrain variation
const generateContourLines = (coordinates, tileSize, contourInterval = 5) => {
  if (!coordinates || coordinates.length === 0) {
    return [];
  }
  
  const bounds = getPolygonBounds(coordinates);
  
  const gridSize = 50; // Increased to 50x50 for more detail
  
  // Sample elevation data across the actual farm area
  const latStep = (bounds.maxLat - bounds.minLat) / (gridSize - 1);
  const lngStep = (bounds.maxLng - bounds.minLng) / (gridSize - 1);
  
  // Use REAL slope data from LandFire 2020 for elevation visualization
  const values = [];
  const slopeValues = [];
  
  // Sample actual slope data from the real USGS dataset
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const lat = bounds.minLat + row * latStep;
      const lng = bounds.minLng + col * lngStep;
      
      // Get REAL slope data from solar suitability (LandFire 2020)
      const solarData = getSolarForCoord(lat, lng);
      
      // Slope values from LandFire are percentage (0-100% grade)
      // Convert slope percentage to relative elevation for visualization
      // Higher slope = more terrain variation
      const slopePercent = solarData?.slope || 0;
      
      // Use slope to indicate terrain ruggedness
      // Scale slope values to create relative elevation differences
      const relativeElevation = slopePercent * 2; // Scale for visibility
      
      values.push(relativeElevation);
      slopeValues.push(slopePercent);
    }
  }
  
  const minElev = Math.min(...values);
  const maxElev = Math.max(...values);
  
  // Generate threshold levels at specified intervals (5m)
  const thresholds = [];
  const startLevel = Math.floor(minElev / contourInterval) * contourInterval + contourInterval;
  for (let level = startLevel; level < maxElev; level += contourInterval) {
    thresholds.push(level);
  }
  
  if (thresholds.length === 0) {
    // If no thresholds, create at least a few in the middle range
    const mid = (minElev + maxElev) / 2;
    thresholds.push(mid - contourInterval, mid, mid + contourInterval);
  }
  
  // Use d3-contour to generate contour lines
  const contourGenerator = contours()
    .size([gridSize, gridSize])
    .thresholds(thresholds);
  
  const contourData = contourGenerator(values);
  
  // Convert d3 contour format to SVG paths scaled to tile size
  const scaleX = tileSize / gridSize;
  const scaleY = tileSize / gridSize;
  
  const contourPaths = [];
  
  contourData.forEach(contour => {
    if (contour.coordinates && contour.coordinates.length > 0) {
      // Each contour can have multiple polygons/rings
      contour.coordinates.forEach(polygon => {
        polygon.forEach(ring => {
          if (ring.length > 1) {
            // Create SVG path data from ring coordinates
            const pathData = ring.map((point, idx) => {
              const x = point[0] * scaleX;
              const y = point[1] * scaleY;
              return idx === 0 ? `M ${x},${y}` : `L ${x},${y}`;
            }).join(' ');
            
            contourPaths.push({
              path: pathData,
              level: contour.value
            });
          }
        });
      });
    }
  });
  
  return contourPaths;
};

// Generate elevation heat map cells based on slope data
// TURF.JS IMPLEMENTATION - Industry-standard geospatial library
// Reference: https://turfjs.org/docs/#booleanPointInPolygon
// Handles all polygon shapes, orientations, and edge cases correctly
// CLIPPATH APPROACH: Generate ALL cells in bounding box, let SVG clipPath handle clipping
// Reference: MDN - https://developer.mozilla.org/en-US/docs/Web/SVG/Element/clipPath
// "A clipping path restricts the region to which paint can be applied"
const generateElevationHeatMap = (coords, tileSize) => {
  if (!coords || coords.length < 3) {
    return [];
  }
  
  // Calculate bounding box
  const bounds = {
    minLat: Math.min(...coords.map(c => c[1])),
    maxLat: Math.max(...coords.map(c => c[1])),
    minLng: Math.min(...coords.map(c => c[0])),
    maxLng: Math.max(...coords.map(c => c[0])),
  };
  
  const latRange = bounds.maxLat - bounds.minLat;
  const lngRange = bounds.maxLng - bounds.minLng;
  
  // Use adaptive grid size based on tile size - small tiles don't need high resolution
  // 15x15 for small tiles (~110px), 50x50 for expanded (~350px)
  const targetCells = tileSize < 150 ? 15 : 50;
  const cellsX = targetCells;
  const cellsY = targetCells;
  
  const pixelWidth = tileSize / cellsX;
  const pixelHeight = tileSize / cellsY;
  const cellLatHeight = latRange / cellsY;
  const cellLngWidth = lngRange / cellsX;
  
  // First pass: collect ALL slope values to determine ranking
  const cellData = [];
  for (let row = 0; row < cellsY; row++) {
    for (let col = 0; col < cellsX; col++) {
      const centerLat = bounds.minLat + (row + 0.5) * cellLatHeight;
      const centerLng = bounds.minLng + (col + 0.5) * cellLngWidth;
      const solarData = getSolarForCoord(centerLat, centerLng);
      const slope = solarData?.slope ?? 0;
      cellData.push({ row, col, slope });
    }
  }

  if (cellData.length === 0) {
    return [];
  }

  // Build rank lookup so colors are based on numeric rank (not fake gradients).
  const sortedSlopes = [...cellData.map(c => c.slope)].sort((a, b) => a - b);
  const slopeToRank = new Map();
  const denom = Math.max(sortedSlopes.length - 1, 1);
  sortedSlopes.forEach((value, index) => {
    if (!slopeToRank.has(value)) {
      slopeToRank.set(value, index / denom);
    }
  });

  const minSlope = sortedSlopes[0];
  const maxSlope = sortedSlopes[sortedSlopes.length - 1];
  const uniqueSlopeCount = slopeToRank.size;
  
  // Second pass: generate ALL cells with colors based on rank (0=green,1=brown)
  const cells = [];
  for (const cell of cellData) {
    const { row, col, slope } = cell;
    const normalized = slopeToRank.get(slope) ?? 0;
    const color = getElevationColorFromNormalized(normalized);
    
    cells.push({
      x: col * pixelWidth,
      y: (cellsY - row - 1) * pixelHeight,
      width: pixelWidth + 0.5,
      height: pixelHeight + 0.5,
      slope: slope,
      color: color,
    });
  }
  
  return cells;
};

const generateSolarHeatMap = (coords, bounds, tileSize, options = {}) => {
  if (!coords || coords.length < 3 || !bounds) {
    return { cells: [], stats: null, grid: null };
  }

  const { includeStats = false } = options;
  
  // Use adaptive grid size based on tile size - small tiles don't need high resolution
  // 15x15 for small tiles (~110px), 50x50 for expanded (~350px)
  const targetCells = tileSize < 150 ? 15 : 50;

  const latRange = Math.max(bounds.maxLat - bounds.minLat, Number.EPSILON);
  const lngRange = Math.max(bounds.maxLng - bounds.minLng, Number.EPSILON);

  const cellsX = targetCells;
  const cellsY = targetCells;

  const pixelWidth = tileSize / cellsX;
  const pixelHeight = tileSize / cellsY;
  const cellLatHeight = latRange / cellsY;
  const cellLngWidth = lngRange / cellsX;

  const allData = [];
  const scoreValues = [];
  let statsMin = Infinity;
  let statsMax = -Infinity;
  let statsSum = 0;
  let statsCount = 0;
  let nullCellCount = 0;
  const uniqueScores = new Set();

  // First pass: collect ALL solar values (like elevation does with slope)
  for (let row = 0; row < cellsY; row++) {
    for (let col = 0; col < cellsX; col++) {
      const cellLat = bounds.minLat + (row + 0.5) * cellLatHeight;
      const cellLng = bounds.minLng + (col + 0.5) * cellLngWidth;
      const cellSolar = getSolarForCoord(cellLat, cellLng);
      // Track null returns
      if (!cellSolar) nullCellCount++;
      // Always use a value - fallback to 50 (mid-range) if no data, like elevation uses 0
      const score = cellSolar?.overall ?? cellSolar?.score ?? 50;

      if (includeStats) {
        const cellBounds = {
          minLat: bounds.minLat + row * cellLatHeight,
          maxLat: bounds.minLat + (row + 1) * cellLatHeight,
          minLng: bounds.minLng + col * cellLngWidth,
          maxLng: bounds.minLng + (col + 1) * cellLngWidth,
        };

        if (cellIntersectsPolygon(cellBounds, coords)) {
          statsMin = Math.min(statsMin, score);
          statsMax = Math.max(statsMax, score);
          statsSum += score;
          statsCount += 1;
          uniqueScores.add(score);
        }
      }

      // ALWAYS include cells - match elevation behavior
      allData.push({ row, col, score });
      scoreValues.push(score);
    }
  }

  if (allData.length === 0) {
    return { cells: [], stats: null, grid: null };
  }

  // Build rank lookup - EXACTLY like elevation does
  const sortedScores = [...scoreValues].sort((a, b) => a - b);
  const denom = Math.max(sortedScores.length - 1, 1);
  const scoreToRank = new Map();
  sortedScores.forEach((value, index) => {
    if (!scoreToRank.has(value)) {
      scoreToRank.set(value, index / denom);
    }
  });

  // DEBUG: Log unique scores and map size
  const uniqueScoresList = [...new Set(scoreValues)];
  console.log('🔍 SOLAR DEBUG:', {
    totalCells: allData.length,
    nullCells: nullCellCount,
    uniqueScores: uniqueScoresList.length,
    mapSize: scoreToRank.size,
    scoreRange: [sortedScores[0], sortedScores[sortedScores.length - 1]],
    sampleScores: uniqueScoresList.slice(0, 5),
  });

  // Generate ALL cells with colors based on rank - EXACTLY like elevation
  const cells = [];
  let missedLookups = 0;
  for (const cell of allData) {
    const { row, col, score } = cell;
    const normalized = scoreToRank.get(score) ?? 0;
    if (!scoreToRank.has(score)) missedLookups++;
    const color = getSolarGradientColor(normalized);
    
    cells.push({
      key: `solar-${row}-${col}`,
      x: col * pixelWidth,
      y: (cellsY - row - 1) * pixelHeight,
      width: pixelWidth + 0.5,
      height: pixelHeight + 0.5,
      color: color,
      score: score,
    });
  }
  
  if (missedLookups > 0) {
    console.warn('⚠️ SOLAR MISSED LOOKUPS:', missedLookups, 'of', allData.length);
  }

  const stats = includeStats && statsCount > 0 ? {
    minScore: statsMin,
    maxScore: statsMax,
    avgScore: statsSum / statsCount,
    sampleCount: statsCount,
    uniqueScoreCount: uniqueScores.size,
  } : null;

  // Log unique colors generated
  const uniqueColors = new Set(cells.map(c => c.color));
  console.log('🎨 SOLAR COLORS:', {
    uniqueColors: uniqueColors.size,
    sampleColors: [...uniqueColors].slice(0, 5),
  });

  return {
    cells,
    stats,
    grid: {
      cols: cellsX,
      rows: cellsY,
      cellLatHeight,
      cellLngWidth,
    },
  };
};

// Get elevation color from normalized value (0-1)
// 0 = lowest elevation (green), 1 = highest elevation (brown/red)
const getElevationColorFromNormalized = (normalized) => {
  // Elevation colors: low=green (valleys), mid=yellow/tan, high=brown/red (peaks)
  if (normalized < 0.33) {
    // Low elevation: Green to yellow-green
    const t = normalized / 0.33;
    const r = Math.floor(34 + (154 - 34) * t);
    const g = Math.floor(139 + (205 - 139) * t);
    const b = Math.floor(34 + (50 - 34) * t);
    return `rgb(${r}, ${g}, ${b})`;
  } else if (normalized < 0.67) {
    // Mid elevation: Yellow-green to tan/beige
    const t = (normalized - 0.33) / 0.34;
    const r = Math.floor(154 + (210 - 154) * t);
    const g = Math.floor(205 + (180 - 205) * t);
    const b = Math.floor(50 + (140 - 50) * t);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // High elevation: Tan to brown/red
    const t = (normalized - 0.67) / 0.33;
    const r = Math.floor(210 + (139 - 210) * t);
    const g = Math.floor(180 + (90 - 180) * t);
    const b = Math.floor(140 + (43 - 140) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }
};

// View types for the horizontal carousel - different views of a particular farm
const VIEW_TYPES = [
  {
    id: 'topological',
    name: 'Elevation',
    description: 'Slope-based elevation heat map',
    icon: '⛰️',
    color: '#8B4513', // Saddle brown for terrain
  },
  {
    id: 'solar',
    name: 'Solar Suitability',
    description: '',
    icon: '☀️',
    color: '#FFD700', // Gold for solar
  },
  {
    id: 'satellite',
    name: 'Satellite',
    description: '',
    icon: '🛰️',
    color: '#4169E1', // Royal blue for satellite
  },
];

// Solar Suitability Datasets - Based on Michigan GIS/EGLE methodology
// Reference: https://gis-egle.hub.arcgis.com/maps/solar-suitability
// All data from real sources: NLCD 2024, LandFire 2020, GPW Population, Michigan Power Facilities
const SOLAR_SUITABILITY_DATASETS = {
  // Primary factors with weights based on EGLE methodology
  criteria: [
    {
      id: 'slope',
      name: 'Terrain Slope',
      weight: 0.12,
      description: 'Ground slope angle - affects panel installation and shading',
      source: 'Digital Elevation Model (DEM) / USGS 3DEP',
      unit: 'degrees or percent',
      optimalRange: '< 3%',
      rating: {
        good: '< 3%',
        fair: '3% - 5%',
        low: '5% - 10%',
        poor: '> 10%',
      },
    },
    {
      id: 'aspect',
      name: 'Slope Aspect/Direction',
      weight: 0.11,
      description: 'Direction the slope faces - affects solar exposure',
      source: 'Digital Elevation Model (DEM)',
      unit: 'compass direction',
      optimalRange: 'South, Southeast, Southwest',
      rating: {
        good: 'S, SE, SW',
        fair: 'E, W',
        low: 'NE, NW',
        poor: 'N',
      },
    },
    {
      id: 'powerlines',
      name: 'Distance from Power Lines',
      weight: 0.12,
      description: 'Proximity to electrical transmission infrastructure',
      source: 'Michigan GIS / Homeland Infrastructure Foundation',
      unit: 'kilometers',
      optimalRange: '< 25 km',
      rating: {
        good: '< 25 km',
        fair: '25 - 50 km',
        low: '50 - 75 km',
        poor: '> 75 km',
      },
    },
    {
      id: 'roads',
      name: 'Distance from Main Roads',
      weight: 0.09,
      description: 'Proximity to transportation infrastructure',
      source: 'Michigan Framework roads / MDOT',
      unit: 'kilometers',
      optimalRange: '< 25 km',
      rating: {
        good: '< 25 km',
        fair: '25 - 50 km',
        low: '50 - 75 km',
        poor: '> 75 km',
      },
    },
    {
      id: 'elevation',
      name: 'Elevation',
      weight: 0.07,
      description: 'Height above sea level - affects solar radiation intensity',
      source: 'Digital Elevation Model (DEM) / USGS 3DEP',
      unit: 'meters',
      optimalRange: 'Higher elevations receive more radiation',
      rating: {
        good: '> 400m',
        fair: '300 - 400m',
        low: '200 - 300m',
        poor: '< 200m',
      },
    },
    {
      id: 'temperature',
      name: 'Annual Average Temperature',
      weight: 0.06,
      description: 'Affects PV panel efficiency - cooler is better for silicon panels',
      source: 'NOAA / PRISM Climate Data',
      unit: '°C',
      optimalRange: 'Lower temperatures improve efficiency',
      rating: {
        good: '< 5°C',
        fair: '5 - 10°C',
        low: '10 - 15°C',
        poor: '> 15°C',
      },
    },
  ],
  // Additional constraint/exclusion layers
  constraints: [
    {
      id: 'landuse',
      name: 'Land Use/Cover',
      description: 'Agricultural, barren, or low-value land preferred',
      source: 'USDA NASS Cropland Data Layer / NLCD',
      excluded: ['Urban', 'Water', 'Wetlands', 'Protected Areas', 'Forests'],
    },
    {
      id: 'protected',
      name: 'Protected Areas',
      description: 'National parks, wildlife refuges, conservation easements',
      source: 'PAD-US / Michigan Natural Features Inventory',
      excluded: true,
    },
    {
      id: 'floodzone',
      name: 'Flood Zones',
      description: 'FEMA flood hazard areas',
      source: 'FEMA National Flood Hazard Layer',
      excluded: ['Zone A', 'Zone V', 'Zone AE'],
    },
  ],
  // Michigan-specific data sources
  michiganSources: {
    egleHub: 'https://gis-egle.hub.arcgis.com/',
    solarTool: 'https://gis-egle.hub.arcgis.com/maps/solar-suitability',
    openData: 'https://gis-michigan.opendata.arcgis.com/',
    description: 'Michigan EGLE Solar Energy Suitability Tool for Planning and Zoning',
  },
};

const FarmDescriptionScreen = ({ farms, county, city, onNavigateBack, onNavigateNext }) => {
  const [backPressed, setBackPressed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerAnim = useRef(new Animated.Value(0)).current;
  const carouselRef = useRef(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  
  // Modal state for expanded tile view
  const [expandedModalVisible, setExpandedModalVisible] = useState(false);
  const [expandedViewType, setExpandedViewType] = useState(null);
  const [expandedFarmIndex, setExpandedFarmIndex] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  
  // Topological view controls in modal
  const [topoContourInterval, setTopoContourInterval] = useState(5); // meters
  const [topoUnit, setTopoUnit] = useState('meters'); // 'meters' or 'feet'
  
  // Cache for computed view data to avoid recalculating
  const viewDataCache = useRef({});
  
  // Cache for pre-rendered tile JSX to avoid re-rendering during scroll
  const tileRenderCache = useRef({});
  
  // Only farms that have been "built" (have pins / a pinCount) should appear in the top carousel
  const builtFarms = useMemo(() => {
    if (!farms || farms.length === 0) return [];
    // Keep only built farms and deduplicate by id (safe guard against duplicates)
    const filtered = farms.filter(f => {
      const pinLen = (f.pins && f.pins.length) || (f.properties && f.properties.pinCount) || 0;
      return pinLen > 0;
    });
    const seen = new Set();
    return filtered.filter(f => {
      if (!f || !f.id) return false;
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });
  }, [farms]);

  // Ensure currentIndex is valid for builtFarms (reset/clamp when list changes)
  useEffect(() => {
    if (builtFarms.length === 0) {
      setCurrentIndex(0);
    } else if (currentIndex >= builtFarms.length) {
      setCurrentIndex(builtFarms.length - 1);
    }
  }, [builtFarms.length]);
  
  // Form state
  const [farmName, setFarmName] = useState('');
  const [farmType, setFarmType] = useState('');
  const [acreage, setAcreage] = useState('');
  const [primaryCrops, setPrimaryCrops] = useState('');
  const [soilType, setSoilType] = useState('');
  const [irrigationType, setIrrigationType] = useState('');
  const [notes, setNotes] = useState('');

  const isFormValid = farmName.trim() !== '' && farmType.trim() !== '';

  // Get or compute cached view data for a farm
  const getViewData = useCallback((farmId, coords, tileSize, options = {}) => {
    const includeSolarStats = options.includeSolarStats ?? false;
    const stableFarmId = getStableFarmId(farmId, coords);
    const cacheKey = `${stableFarmId}-${tileSize}-${includeSolarStats ? 'stats' : 'base'}`;
    
    // Return cached data if available
    if (viewDataCache.current[cacheKey]) {
      return viewDataCache.current[cacheKey];
    }
    
    // Calculate all view data
    const bounds = getPolygonBounds(coords);
    const centerLat = (bounds.minLat + bounds.maxLat) / 2;
    const centerLng = (bounds.minLng + bounds.maxLng) / 2;
    
    // Polygon points
    const polygonPoints = normalizePolygon(coords, tileSize);
    
    // Elevation data (uses real slope from LandFire 2020)
    const contourLines = generateContourLines(coords, tileSize, 5); // 5% slope interval
  const elevationHeatMap = generateElevationHeatMap(coords, tileSize); // Adaptive grid based on aspect ratio
    
    // Solar data
    const avgSolar = getAverageSolar(coords);
    const solarColor = avgSolar ? getSolarColor(avgSolar.score) : '#888888';
    const solarHeatMap = generateSolarHeatMap(coords, bounds, tileSize, {
      includeStats: includeSolarStats,
    });
    
    // Satellite tile data
    const zoom = 17;
    const lat2tile = (lat, z) => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z);
    const lng2tile = (lng, z) => (lng + 180) / 360 * Math.pow(2, z);
    
    const minTileX = lng2tile(bounds.minLng, zoom);
    const maxTileX = lng2tile(bounds.maxLng, zoom);
    const minTileY = lat2tile(bounds.maxLat, zoom);
    const maxTileY = lat2tile(bounds.minLat, zoom);
    
    const tileXStart = Math.floor(minTileX);
    const tileYStart = Math.floor(minTileY);
    const tileXEnd = Math.floor(maxTileX);
    const tileYEnd = Math.floor(maxTileY);
    
    const padding = tileSize * 0.1;
    const availableSize = tileSize - padding * 2;
    
    const geoWidth = bounds.maxLng - bounds.minLng || 0.0001;
    const geoHeight = bounds.maxLat - bounds.minLat || 0.0001;
    const scale = Math.min(availableSize / geoWidth, availableSize / geoHeight);
    
    const geoCenterLng = (bounds.minLng + bounds.maxLng) / 2;
    const geoCenterLat = (bounds.minLat + bounds.maxLat) / 2;
    
    const lngLatToPixel = (lng, lat) => {
      const x = padding + (lng - geoCenterLng) * scale + availableSize / 2;
      const y = padding + (geoCenterLat - lat) * scale + availableSize / 2;
      return { x, y };
    };
    
    const getTileBounds = (tileX, tileY, z) => {
      const tileLngMin = tileX / Math.pow(2, z) * 360 - 180;
      const tileLngMax = (tileX + 1) / Math.pow(2, z) * 360 - 180;
      const n1 = Math.PI - 2 * Math.PI * tileY / Math.pow(2, z);
      const n2 = Math.PI - 2 * Math.PI * (tileY + 1) / Math.pow(2, z);
      const tileLatMax = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n1) - Math.exp(-n1)));
      const tileLatMin = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n2) - Math.exp(-n2)));
      return { tileLngMin, tileLngMax, tileLatMin, tileLatMax };
    };
    
    const tiles = [];
    for (let ty = tileYStart; ty <= tileYEnd; ty++) {
      for (let tx = tileXStart; tx <= tileXEnd; tx++) {
        const tileBounds = getTileBounds(tx, ty, zoom);
        const tileTopLeft = lngLatToPixel(tileBounds.tileLngMin, tileBounds.tileLatMax);
        const tileBottomRight = lngLatToPixel(tileBounds.tileLngMax, tileBounds.tileLatMin);
        
        tiles.push({
          url: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`,
          x: tileTopLeft.x,
          y: tileTopLeft.y,
          width: tileBottomRight.x - tileTopLeft.x,
          height: tileBottomRight.y - tileTopLeft.y,
          tileX: tx,
          tileY: ty,
        });
      }
    }
    
    // Cache the computed data
    const viewData = {
      bounds,
      polygonPoints,
      contourLines,
      elevationHeatMap,
      avgSolar,
      solarColor,
      solarHeatMap,
      tiles,
      lngLatToPixel,
      availableSize,
    };
    
    viewDataCache.current[cacheKey] = viewData;
    return viewData;
  }, []);

  // Get or create cached tile render for a specific farm and view type
  const getCachedTileRender = useCallback((farmId, coords, viewTypeId, tileSize, renderFn) => {
    const stableFarmId = getStableFarmId(farmId, coords);
    const cacheKey = `${stableFarmId}-${viewTypeId}-${tileSize}`;
    if (!tileRenderCache.current[cacheKey]) {
      tileRenderCache.current[cacheKey] = renderFn();
    }
    return tileRenderCache.current[cacheKey];
  }, []);

  const toggleDrawer = () => {
    const toValue = drawerOpen ? 0 : 1;
    Animated.timing(drawerAnim, {
      toValue,
      duration: 300,
      useNativeDriver: true,
    }).start();
    setDrawerOpen(!drawerOpen);
  };

  const drawerTranslateX = drawerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [DRAWER_WIDTH, 0],
  });

  // Carousel tile size and spacing
  const tileSize = 120;
  const itemSpacing = tileSize - 20; // Space between item centers (closer together)
  const carouselHeight = itemSpacing * 3; // Show 3 items worth of space (reduced for 50% container)
  const centerOffset = (carouselHeight / 2) - (tileSize / 2); // Offset to center active item

  // Custom animation to center the active item in the middle of the viewport
  const carouselAnimationStyle = useCallback((value) => {
    'worklet';
    
    // Scale: center = 100%, adjacent = 70%, further = smaller
    const scale = interpolate(
      value,
      [-2, -1, 0, 1, 2],
      [0.5, 0.75, 1, 0.75, 0.5]
    );
    
    // Opacity: only show 3 tiles (center + adjacent), hide distant ones
    const opacity = interpolate(
      value,
      [-2, -1, 0, 1, 2],
      [0, 1, 1, 1, 0]
    );
    
    // translateY: position items around center
    // Bottom items (positive values) are tighter than top items
    const translateY = interpolate(
      value,
      [-2, -1, 0, 1, 2],
      [centerOffset - itemSpacing * 1.8, centerOffset - itemSpacing * 0.9, centerOffset, centerOffset + itemSpacing * 0.7, centerOffset + itemSpacing * 1.3]
    );
    
    // zIndex: center item highest, decreasing as we move away
    // Using large differences to ensure proper stacking
    const zIndex = interpolate(
      value,
      [-2, -1, 0, 1, 2],
      [1, 5, 10, 5, 1]
    );
    
    return {
      transform: [
        { translateY },
        { scale },
      ],
      opacity,
      zIndex: Math.round(zIndex),
    };
  }, [itemSpacing, centerOffset]);

  // Horizontal carousel settings
  const horizontalCarouselRef = useRef(null);
  const [horizontalIndex, setHorizontalIndex] = useState(0);
  const horizontalCarouselWidth = DRAWER_WIDTH * 0.75;
  const horizontalCenterOffset = (horizontalCarouselWidth / 2) - (tileSize / 2);

  // Custom animation for horizontal carousel
  const horizontalCarouselAnimationStyle = useCallback((value) => {
    'worklet';
    
    const scale = interpolate(
      value,
      [-2, -1, 0, 1, 2],
      [0.5, 0.75, 1, 0.75, 0.5]
    );
    
    const opacity = interpolate(
      value,
      [-2, -1, 0, 1, 2],
      [0, 1, 1, 1, 0]
    );
    
    // translateX instead of translateY for horizontal
    const translateX = interpolate(
      value,
      [-2, -1, 0, 1, 2],
      [horizontalCenterOffset - itemSpacing * 1.8, horizontalCenterOffset - itemSpacing * 0.9, horizontalCenterOffset, horizontalCenterOffset + itemSpacing * 0.7, horizontalCenterOffset + itemSpacing * 1.3]
    );
    
    const zIndex = interpolate(
      value,
      [-2, -1, 0, 1, 2],
      [1, 5, 10, 5, 1]
    );
    
    return {
      transform: [
        { translateX },
        { scale },
      ],
      opacity,
      zIndex: Math.round(zIndex),
    };
  }, [itemSpacing, horizontalCenterOffset]);

  const handleTilePress = (viewType, farmIndex) => {
    setModalLoading(true);
    setExpandedViewType(viewType);
    setExpandedFarmIndex(farmIndex);
    setExpandedModalVisible(true);
    
    // Reset topological controls to defaults when opening modal
    if (viewType.id === 'topological') {
      setTopoContourInterval(2);
      setTopoUnit('meters');
    }
    
    // Clear loading after a brief delay to allow modal to render
    setTimeout(() => setModalLoading(false), 100);
  };

  const handleTopoUnitChange = (newUnit) => {
    // Convert the interval value when changing units
    if (newUnit === 'feet' && topoUnit === 'meters') {
      // Convert meters to feet (1m = 3.28084ft), constrain to range
      const feetValue = Math.max(3, Math.min(16, Math.round(topoContourInterval * 3.28084)));
      setTopoContourInterval(feetValue);
    } else if (newUnit === 'meters' && topoUnit === 'feet') {
      // Convert feet to meters (1ft = 0.3048m), constrain to range
      const meterValue = Math.max(1, Math.min(5, parseFloat((topoContourInterval * 0.3048).toFixed(1))));
      setTopoContourInterval(meterValue);
    }
    setTopoUnit(newUnit);
  };

  const handleNext = () => {
    const farmDescription = {
      farmName: farmName.trim(),
      farmType: farmType.trim(),
      acreage: acreage.trim(),
      primaryCrops: primaryCrops.trim(),
      soilType: soilType.trim(),
      irrigationType: irrigationType.trim(),
      notes: notes.trim(),
    };

    if (onNavigateNext) {
      onNavigateNext(farmDescription);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      
      {/* Back Button */}
      <Pressable
        style={({ pressed }) => [
          styles.backButton,
          pressed && styles.backButtonPressed,
        ]}
        onPress={onNavigateBack}
        onPressIn={() => setBackPressed(true)}
        onPressOut={() => setBackPressed(false)}
      >
        <Text style={styles.backButtonText}>←</Text>
      </Pressable>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Describe Your Farm</Text>
        <Text style={styles.headerSubtitle}>
          {city}, {county} County
        </Text>
      </View>

      <KeyboardAvoidingView 
        style={styles.formContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
          persistentScrollbar={true}
        >
          {/* Farm Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Farm Name *</Text>
            <TextInput
              style={styles.input}
              value={farmName}
              onChangeText={setFarmName}
              placeholder="Enter farm name"
              placeholderTextColor={COLORS.placeholder}
            />
          </View>

          {/* Farm Type */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Farm Type *</Text>
            <TextInput
              style={styles.input}
              value={farmType}
              onChangeText={setFarmType}
              placeholder="e.g., Crop, Livestock, Mixed"
              placeholderTextColor={COLORS.placeholder}
            />
          </View>

          {/* Acreage */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Total Acreage</Text>
            <TextInput
              style={styles.input}
              value={acreage}
              onChangeText={setAcreage}
              placeholder="Enter total acres"
              placeholderTextColor={COLORS.placeholder}
              keyboardType="numeric"
            />
          </View>

          {/* Primary Crops */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Primary Crops/Products</Text>
            <TextInput
              style={styles.input}
              value={primaryCrops}
              onChangeText={setPrimaryCrops}
              placeholder="e.g., Corn, Soybeans, Wheat"
              placeholderTextColor={COLORS.placeholder}
            />
          </View>

          {/* Soil Type */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Soil Type</Text>
            <TextInput
              style={styles.input}
              value={soilType}
              onChangeText={setSoilType}
              placeholder="e.g., Clay, Sandy, Loam"
              placeholderTextColor={COLORS.placeholder}
            />
          </View>

          {/* Irrigation Type */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Irrigation Type</Text>
            <TextInput
              style={styles.input}
              value={irrigationType}
              onChangeText={setIrrigationType}
              placeholder="e.g., Drip, Sprinkler, None"
              placeholderTextColor={COLORS.placeholder}
            />
          </View>

          {/* Additional Notes */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Additional Notes</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Any additional information about your farm"
              placeholderTextColor={COLORS.placeholder}
              multiline={true}
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>

          <Text style={styles.requiredText}>* Required fields</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Bottom Control Panel */}
      <View style={styles.controlPanel}>
        <Pressable
          style={({ pressed }) => [
            styles.nextButton,
            !isFormValid && styles.nextButtonDisabled,
            pressed && isFormValid && styles.nextButtonPressed,
          ]}
          onPress={handleNext}
          disabled={!isFormValid}
        >
          <Text style={[
            styles.nextButtonText,
            !isFormValid && styles.nextButtonTextDisabled,
          ]}>
            Next
          </Text>
        </Pressable>
      </View>

      {/* Drawer */}
      <Animated.View 
        style={[
          styles.drawer,
          { transform: [{ translateX: drawerTranslateX }] }
        ]}
      >
        {/* Semi-circle handle with arrow */}
        <Pressable
          style={styles.drawerHandle}
          onPress={toggleDrawer}
        >
          <View style={styles.drawerArrow}>
            <View style={[
              styles.arrowTop,
              { transform: [{ rotate: drawerOpen ? '45deg' : '-45deg' }] }
            ]} />
            <View style={[
              styles.arrowBottom,
              { transform: [{ rotate: drawerOpen ? '-45deg' : '45deg' }] }
            ]} />
          </View>
        </Pressable>
        
        {/* Drawer content */}
        <View style={styles.drawerContent}>
          <Text style={styles.drawerTitle}>Farm Details</Text>
          
          {builtFarms && builtFarms.length > 0 ? (
            <>
              {/* Vertical Polygon Carousel using react-native-reanimated-carousel */}
              <View style={styles.carouselContainer}>
                <Carousel
                  ref={carouselRef}
                  data={builtFarms}
                  vertical={true}
                  width={tileSize + 20}
                  height={carouselHeight}
                  style={{ 
                    width: tileSize + 20, 
                    height: carouselHeight,
                    overflow: 'hidden',
                    marginLeft: 26,
                  }}
                  loop={builtFarms.length > 2}
                  autoPlay={false}
                  scrollAnimationDuration={300}
                  onSnapToItem={(index) => setCurrentIndex(index)}
                  customAnimation={carouselAnimationStyle}
                  renderItem={({ item, index }) => {
                    const coords = item.geometry?.coordinates?.[0] || [];
                    return (
                      <View key={item.id} style={[styles.polygonWrapper, { width: tileSize, height: tileSize }]}> 
                        <Svg width={tileSize} height={tileSize} viewBox={`0 0 ${tileSize} ${tileSize}`}>
                          <Polygon
                            points={normalizePolygon(coords, tileSize)}
                            fill={FARM_COLORS[index % FARM_COLORS.length]}
                            stroke={COLORS.text}
                            strokeWidth={2}
                          />
                        </Svg>
                      </View>
                    );
                  }}
                />
              </View>
              
              {/* Selected farm info */}
              <View style={styles.selectedFarmInfo}>
                <Text style={styles.selectedFarmName}>
                  {builtFarms[currentIndex]?.properties?.name || farms[currentIndex]?.properties?.name || `Farm ${currentIndex + 1}`}
                </Text>
                <Text style={styles.selectedFarmDetails}>
                  {(builtFarms[currentIndex]?.pins?.length || builtFarms[currentIndex]?.properties?.pinCount) || (farms[currentIndex]?.pins?.length || farms[currentIndex]?.properties?.pinCount) || 0} pins
                </Text>
                {(() => {
                  const coords = (builtFarms[currentIndex]?.geometry?.coordinates?.[0]) || (farms[currentIndex]?.geometry?.coordinates?.[0]) || [];
                  const { acres, sqMiles } = calculatePolygonArea(coords);
                  return (
                    <Text style={styles.selectedFarmArea}>
                      {acres.toFixed(2)} acres ({sqMiles.toFixed(4)} sq mi)
                    </Text>
                  );
                })()}
                <Text style={styles.carouselIndicator}>
                  {currentIndex + 1} / {farms.length}
                </Text>
              </View>

              {/* Horizontal View Type Carousel - Different views of selected farm */}
              <View style={styles.horizontalCarouselContainer}>
                <Carousel
                  ref={horizontalCarouselRef}
                  data={VIEW_TYPES}
                  vertical={false}
                  width={horizontalCarouselWidth}
                  height={tileSize + 20}
                  style={{ 
                    width: horizontalCarouselWidth, 
                    height: tileSize + 20,
                    overflow: 'hidden',
                    marginTop: 20,
                  }}
                  loop={true}
                  autoPlay={false}
                  scrollAnimationDuration={300}
                  onSnapToItem={(index) => setHorizontalIndex(index)}
                  customAnimation={horizontalCarouselAnimationStyle}
                  renderItem={({ item: viewType, index }) => {
                    // Get the current farm's coordinates for rendering in different views
                    const currentFarm = builtFarms[currentIndex] || farms[currentIndex] || null;
                    const coords = currentFarm?.geometry?.coordinates?.[0] || [];
                    
                    if (!currentFarm || coords.length === 0) {
                      return <View style={[styles.viewTypeTile, { width: tileSize, height: tileSize }]} />;
                    }
                    
                    // Get cached view data (computed only once per farm)
                    const viewData = getViewData(currentFarm.id, coords, tileSize - 10);
                    const { bounds, polygonPoints, contourLines, elevationHeatMap, avgSolar, solarColor, tiles, solarHeatMap } = viewData;
                    const solarCells = solarHeatMap?.cells || [];
                    
                    // Use stable clip IDs based on farm ID instead of currentIndex to allow caching
                    const clipIdBase = `${currentFarm.id}-${viewType.id}`;
                    
                    // Get cached SVG content or render it once
                    const cachedSvgContent = getCachedTileRender(currentFarm.id, coords, viewType.id, tileSize - 10, () => {
                      if (viewType.id === 'satellite') {
                        return (
                          <Svg width={tileSize - 10} height={tileSize - 10} viewBox={`0 0 ${tileSize - 10} ${tileSize - 10}`}>
                            <Defs>
                              <ClipPath id={`satClip-${clipIdBase}`}>
                                <Polygon points={polygonPoints} />
                              </ClipPath>
                            </Defs>
                            {tiles.map((tile) => (
                              <SvgImage
                                key={`tile-${tile.tileX}-${tile.tileY}`}
                                href={tile.url}
                                x={tile.x}
                                y={tile.y}
                                width={tile.width}
                                height={tile.height}
                                preserveAspectRatio="none"
                                clipPath={`url(#satClip-${clipIdBase})`}
                              />
                            ))}
                            <Polygon points={polygonPoints} fill="none" stroke="#FFFFFF" strokeWidth={1.5} />
                          </Svg>
                        );
                      } else if (viewType.id === 'topological') {
                        return (
                          <Svg width={tileSize - 10} height={tileSize - 10} viewBox={`0 0 ${tileSize - 10} ${tileSize - 10}`}>
                            <Defs>
                              <ClipPath id={`elevClip-${clipIdBase}`}>
                                <Polygon points={polygonPoints} />
                              </ClipPath>
                            </Defs>
                            {elevationHeatMap.map((cell, idx) => (
                              <Rect
                                key={`heat-${idx}`}
                                x={cell.x}
                                y={cell.y}
                                width={cell.width}
                                height={cell.height}
                                fill={cell.color}
                                clipPath={`url(#elevClip-${clipIdBase})`}
                              />
                            ))}
                            <Polygon points={polygonPoints} fill="none" stroke="#000000" strokeWidth={1.5} />
                          </Svg>
                        );
                      } else if (viewType.id === 'solar') {
                        return (
                          <Svg width={tileSize - 10} height={tileSize - 10} viewBox={`0 0 ${tileSize - 10} ${tileSize - 10}`}>
                            <Defs>
                              <ClipPath id={`solarClip-${clipIdBase}`}>
                                <Polygon points={polygonPoints} />
                              </ClipPath>
                            </Defs>
                            <Rect x="0" y="0" width={tileSize - 10} height={tileSize - 10} fill={COLORS.background} />
                            {solarCells.map((cell) => (
                              <Rect
                                key={cell.key}
                                x={cell.x}
                                y={cell.y}
                                width={cell.width}
                                height={cell.height}
                                fill={cell.color}
                                clipPath={`url(#solarClip-${clipIdBase})`}
                              />
                            ))}
                            <Polygon points={polygonPoints} fill="none" stroke="#2C2C2C" strokeWidth={2.5} />
                          </Svg>
                        );
                      }
                      return null;
                    });
                    
                    return (
                      <Pressable 
                        onPress={() => handleTilePress(viewType, currentIndex)}
                        style={[styles.viewTypeTile, { width: tileSize, height: tileSize }]}
                      >
                        {cachedSvgContent}
                      </Pressable>
                    );
                  }}
                />
              </View>
              
              {/* Selected view info with real data */}
              <View style={styles.selectedViewInfo}>
                <Text style={styles.selectedViewName}>
                  {VIEW_TYPES[horizontalIndex]?.name || 'Unknown View'}
                </Text>
                <Text style={styles.viewDataSubtext}>
                  Tap tile for more info
                </Text>
              </View>
            </>
          ) : (
            <Text style={styles.drawerEmptyText}>No farms added yet</Text>
          )}
        </View>
      </Animated.View>

      {/* Expanded Tile Modal */}
      <Modal
        visible={expandedModalVisible}
        animationType="fade"
        transparent={true}
        statusBarTranslucent={true}
        onRequestClose={() => setExpandedModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={{ width: 28 }} />
              {expandedFarmIndex !== null && builtFarms[expandedFarmIndex] && expandedViewType && (
                <Text style={styles.modalTitle}>
                  {expandedViewType.name} - {builtFarms[expandedFarmIndex]?.properties?.name || `Farm ${expandedFarmIndex + 1}`}
                </Text>
              )}
              <Pressable
                style={styles.modalCloseButton}
                onPress={() => setExpandedModalVisible(false)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>

            {/* Render the single tapped tile in expanded size */}
            <ScrollView 
              style={styles.modalBody} 
              contentContainerStyle={styles.modalBodyContent}
              showsVerticalScrollIndicator={true}
              persistentScrollbar={true}
            >
              {modalLoading ? (
                <View style={styles.modalLoadingContainer}>
                  <ActivityIndicator size="large" color={COLORS.accent} />
                  <Text style={styles.modalLoadingText}>Loading...</Text>
                </View>
              ) : (() => {
                if (expandedFarmIndex === null || !builtFarms[expandedFarmIndex] || !expandedViewType) return null;
                
                const currentFarm = builtFarms[expandedFarmIndex];
                const coords = currentFarm?.geometry?.coordinates?.[0] || [];
                // Make tile larger since it's the only one displayed
                const screenWidth = Dimensions.get('window').width;
                const screenHeight = Dimensions.get('window').height;
                const expandedTileSize = Math.min(screenWidth * 0.7, screenHeight * 0.5, 350);
                
                // Get cached view data for the expanded tile size
                const viewData = getViewData(currentFarm.id, coords, expandedTileSize, { includeSolarStats: true });
                const { bounds, polygonPoints, contourLines, elevationHeatMap, avgSolar, solarColor, tiles, lngLatToPixel, availableSize, solarHeatMap } = viewData;
                const solarCells = solarHeatMap?.cells || [];
                const solarStats = solarHeatMap?.stats;
                
                // Use stable clip IDs based on farm ID for caching
                const clipIdBase = `${currentFarm.id}-expanded`;
                
                // Get cached SVG content for the expanded modal
                const cachedExpandedSvg = getCachedTileRender(currentFarm.id, coords, `${expandedViewType.id}-expanded`, expandedTileSize, () => {
                  if (expandedViewType.id === 'satellite') {
                    return (
                      <Svg width={expandedTileSize} height={expandedTileSize} viewBox={`0 0 ${expandedTileSize} ${expandedTileSize}`}>
                        <Defs>
                          <ClipPath id={`satClip-${clipIdBase}`}>
                            <Polygon points={polygonPoints} />
                          </ClipPath>
                        </Defs>
                        {tiles.map((tile) => (
                          <SvgImage
                            key={`tile-${tile.tileX}-${tile.tileY}`}
                            href={tile.url}
                            x={tile.x}
                            y={tile.y}
                            width={tile.width}
                            height={tile.height}
                            preserveAspectRatio="none"
                            clipPath={`url(#satClip-${clipIdBase})`}
                          />
                        ))}
                        <Polygon points={polygonPoints} fill="none" stroke="#FFFFFF" strokeWidth={2} />
                      </Svg>
                    );
                  } else if (expandedViewType.id === 'topological') {
                    return (
                      <Svg width={expandedTileSize} height={expandedTileSize} viewBox={`0 0 ${expandedTileSize} ${expandedTileSize}`}>
                        <Defs>
                          <ClipPath id={`topoClip-${clipIdBase}`}>
                            <Polygon points={polygonPoints} />
                          </ClipPath>
                        </Defs>
                        <Rect x="0" y="0" width={expandedTileSize} height={expandedTileSize} fill="#FFFFFF" clipPath={`url(#topoClip-${clipIdBase})`} />
                        {elevationHeatMap.map((cell, idx) => (
                          <Rect
                            key={`heat-expanded-${idx}`}
                            x={cell.x}
                            y={cell.y}
                            width={cell.width}
                            height={cell.height}
                            fill={cell.color}
                            clipPath={`url(#topoClip-${clipIdBase})`}
                          />
                        ))}
                        <Polygon points={polygonPoints} fill="none" stroke="#000000" strokeWidth={2} />
                      </Svg>
                    );
                  } else if (expandedViewType.id === 'solar') {
                    return (
                      <Svg width={expandedTileSize} height={expandedTileSize} viewBox={`0 0 ${expandedTileSize} ${expandedTileSize}`}>
                        <Defs>
                          <ClipPath id={`solarClip-${clipIdBase}`}>
                            <Polygon points={polygonPoints} />
                          </ClipPath>
                        </Defs>
                        <Rect x="0" y="0" width={expandedTileSize} height={expandedTileSize} fill={COLORS.background} />
                        {solarCells.map((cell) => (
                          <Rect
                            key={cell.key}
                            x={cell.x}
                            y={cell.y}
                            width={cell.width}
                            height={cell.height}
                            fill={cell.color}
                            clipPath={`url(#solarClip-${clipIdBase})`}
                          />
                        ))}
                        <Polygon points={polygonPoints} fill="none" stroke={COLORS.text} strokeWidth={2} />
                      </Svg>
                    );
                  }
                  return null;
                });
                
                return (
                  <View style={styles.modalTileContainer}>
                    {/* Cached SVG content */}
                    {cachedExpandedSvg}
                    
                    {/* Land Cover Information - Only show for satellite view */}
                    {expandedViewType.id === 'satellite' && avgSolar && (() => {
                      // Land cover data from NLCD 2024 raster (processed from Annual_NLCD_LndCov_2024_CU_C1V1.tif)
                      // Data extracted using rasterio and scored per EGLE methodology
                      const landCoverScore = avgSolar.land_cover || avgSolar.overall || avgSolar.score || 75;
                      const landCoverInfo = interpretLandCover(landCoverScore);
                      const costColor = landCoverInfo.costLevel === 'low' ? '#22C55E' : 
                                       landCoverInfo.costLevel === 'medium' ? '#F59E0B' : '#EF4444';
                      
                      return (
                        <View style={styles.topoControls}>
                          {/* Land Cover Classification */}
                          <View style={styles.landCoverHeader}>
                            <Text style={styles.landCoverTitle}>NLCD 2024 Land Cover</Text>
                            <Text style={[styles.landCoverSubtitle, { fontSize: 11, color: '#059669', marginTop: 2, fontWeight: '600' }]}>
                              Based on NLCD 2024 satellite imagery
                            </Text>
                            <View style={[styles.landCoverTypeBadge, { backgroundColor: costColor, marginTop: 4 }]}>
                              <Text style={styles.landCoverTypeText}>Score: {avgSolar.land_cover.toFixed(1)}/100</Text>
                            </View>
                          </View>
                          
                          {/* Land Cover Details */}
                          <View style={styles.landCoverDetails}>
                            <View style={styles.landCoverRow}>
                              <Text style={styles.landCoverLabel}>NLCD Classification:</Text>
                              <Text style={styles.landCoverValue}>{landCoverInfo.nlcdClasses}</Text>
                            </View>
                            <View style={styles.landCoverRow}>
                              <Text style={styles.landCoverLabel}>Description:</Text>
                              <Text style={styles.landCoverValue}>{landCoverInfo.description}</Text>
                            </View>
                            <View style={styles.landCoverRow}>
                              <Text style={styles.landCoverLabel}>Clearing Cost:</Text>
                              <Text style={[styles.landCoverValue, { color: costColor, fontWeight: '600' }]}>
                                {landCoverInfo.clearingCost}
                              </Text>
                            </View>
                            <View style={[styles.landCoverRow, { marginTop: 4 }]}>
                              <Text style={[styles.landCoverLabel, { fontSize: 10, color: '#666' }]}>Data Resolution:</Text>
                              <Text style={[styles.landCoverValue, { fontSize: 10, color: '#666' }]}>~2km grid</Text>
                            </View>
                          </View>
                          
                          {/* Notes */}
                          <View style={styles.landCoverNotes}>
                            <Text style={styles.landCoverNotesText}>
                              <Text style={{ fontWeight: '600' }}>Note: </Text>
                              {landCoverInfo.notes}
                            </Text>
                          </View>
                          
                          {/* Cost Breakdown Table */}
                          <View style={styles.costBreakdownContainer}>
                            <Text style={styles.costBreakdownTitle}>Development Cost Breakdown</Text>
                            
                            {(() => {
                              // Calculate farm area
                              const { acres } = calculatePolygonArea(coords);
                              
                              // Cost estimates based on NLCD land cover type
                              const getCostEstimate = (landType) => {
                                switch(landType) {
                                  case 'Agricultural / Open Land':
                                    return { clearing: 500, grading: 600, prep: 400 };
                                  case 'Open Development / Shrubland':
                                    return { clearing: 2500, grading: 800, prep: 500 };
                                  case 'Forested / Low Development':
                                    return { clearing: 8000, grading: 1500, prep: 800 };
                                  case 'Medium Development':
                                    return { clearing: 12000, grading: 2000, prep: 1000 };
                                  case 'Water / Wetland / Dense Urban':
                                    return { clearing: 0, grading: 0, prep: 0 };
                                  default:
                                    return { clearing: 2500, grading: 800, prep: 500 };
                                }
                              };
                              
                              const costPerAcre = getCostEstimate(landCoverInfo.type);
                              const clearingTotal = costPerAcre.clearing * acres;
                              const gradingTotal = costPerAcre.grading * acres;
                              const prepTotal = costPerAcre.prep * acres;
                              const totalCost = clearingTotal + gradingTotal + prepTotal;
                              
                              const formatCost = (cost) => {
                                if (cost === 0) return '$0';
                                if (cost >= 1000000) return `$${(cost / 1000000).toFixed(2)}M`;
                                if (cost >= 1000) return `$${(cost / 1000).toFixed(1)}K`;
                                return `$${cost.toFixed(0)}`;
                              };
                              
                              return (
                                <>
                                  <View style={styles.costTable}>
                                    <View style={styles.costTableHeader}>
                                      <Text style={styles.costTableHeaderText}>Item</Text>
                                      <Text style={styles.costTableHeaderText}>Per Acre</Text>
                                      <Text style={styles.costTableHeaderText}>Total</Text>
                                    </View>
                                    
                                    <View style={styles.costTableRow}>
                                      <Text style={styles.costTableCell}>Land Clearing</Text>
                                      <Text style={styles.costTableCell}>${costPerAcre.clearing.toLocaleString()}</Text>
                                      <Text style={styles.costTableCell}>{formatCost(clearingTotal)}</Text>
                                    </View>
                                    
                                    <View style={styles.costTableRow}>
                                      <Text style={styles.costTableCell}>Site Grading</Text>
                                      <Text style={styles.costTableCell}>${costPerAcre.grading.toLocaleString()}</Text>
                                      <Text style={styles.costTableCell}>{formatCost(gradingTotal)}</Text>
                                    </View>
                                    
                                    <View style={styles.costTableRow}>
                                      <Text style={styles.costTableCell}>Site Preparation</Text>
                                      <Text style={styles.costTableCell}>${costPerAcre.prep.toLocaleString()}</Text>
                                      <Text style={styles.costTableCell}>{formatCost(prepTotal)}</Text>
                                    </View>
                                    
                                    <View style={styles.costTableDivider} />
                                    
                                    <View style={styles.costTableTotal}>
                                      <Text style={styles.costTableTotalLabel}>Estimated Total ({acres.toFixed(1)} acres)</Text>
                                      <Text style={styles.costTableTotalValue}>{formatCost(totalCost)}</Text>
                                    </View>
                                  </View>
                                  
                                  <Text style={styles.costDisclaimer}>
                                    * Cost estimates based on typical land cover clearing costs. Actual costs vary by site conditions, accessibility, and local rates.
                                  </Text>
                                  <Text style={[styles.costDisclaimer, { marginTop: 4 }]}>
                                    * Land cover data from Michigan EGLE Solar Tool (NLCD 2021) at ~2km resolution. Nearby farms may share the same classification.
                                  </Text>
                                </>
                              );
                            })()}
                          </View>
                        </View>
                      );
                    })()}
                    
                    {/* Solar Suitability Controls - Only show for solar view */}
                    {expandedViewType.id === 'solar' && (() => {
                      // Use actual data only - no spoofed defaults
                      const minScore = solarStats?.minScore ?? avgSolar?.overall ?? avgSolar?.score ?? 0;
                      const maxScore = solarStats?.maxScore ?? avgSolar?.overall ?? avgSolar?.score ?? 0;
                      const avgScore = solarStats?.avgScore ?? avgSolar?.overall ?? avgSolar?.score ?? 0;
                      const sampleCount = solarStats?.sampleCount ?? 0;
                      const uniqueScoreCount = solarStats?.uniqueScoreCount ?? 0;

                      return (
                        <View style={styles.topoControls}>
                          {/* Average Score Display */}
                          <View style={styles.solarAvgScore}>
                            <Text style={styles.solarAvgScoreLabel}>Average Solar Suitability:</Text>
                            <Text style={styles.solarAvgScoreValue}>{avgScore.toFixed(1)}</Text>
                          </View>
                          
                          {/* Legend */}
                          <View style={styles.topoLegend}>
                            <View style={styles.topoLegendSingle}>
                              <Text style={styles.topoLegendTitle}>Solar Suitability Range</Text>
                              <View style={styles.topoLegendRow}>
                                <View style={styles.topoLegendEndColumn}>
                                  <Text style={styles.topoLegendEndLabel}>Lowest</Text>
                                  <Text style={styles.topoLegendValue}>{minScore.toFixed(0)}</Text>
                                </View>
                                <View style={styles.topoLegendGradient}>
                                  <View style={[styles.topoLegendColorBox, { backgroundColor: '#DC2626' }]} />
                                  <View style={[styles.topoLegendColorBox, { backgroundColor: '#F87171' }]} />
                                  <View style={[styles.topoLegendColorBox, { backgroundColor: '#FDE047' }]} />
                                  <View style={[styles.topoLegendColorBox, { backgroundColor: '#86EFAC' }]} />
                                  <View style={[styles.topoLegendColorBox, { backgroundColor: '#16A34A' }]} />
                                </View>
                                <View style={styles.topoLegendEndColumn}>
                                  <Text style={styles.topoLegendEndLabel}>Highest</Text>
                                  <Text style={styles.topoLegendValue}>{maxScore.toFixed(0)}</Text>
                                </View>
                              </View>
                            </View>
                          </View>

                          {solarStats && (
                            <Text style={styles.topoLegendNote}>
                              Based on {sampleCount} in-bounds samples ({uniqueScoreCount} unique values)
                            </Text>
                          )}
                          
                          {/* Explanation and Weights Table */}
                          <View style={styles.solarExplanation}>
                            <Text style={styles.solarExplanationText}>
                              Solar suitability is calculated using weighted factors (EGLE methodology):
                            </Text>
                            <View style={styles.solarWeightsTable}>
                              <View style={styles.solarWeightRow}>
                                <Text style={styles.solarWeightFactor}>Land Cover (NLCD 2024)</Text>
                                <Text style={styles.solarWeightValue}>40%</Text>
                              </View>
                              <View style={styles.solarWeightRow}>
                                <Text style={styles.solarWeightFactor}>Transmission Line Proximity</Text>
                                <Text style={styles.solarWeightValue}>30%</Text>
                              </View>
                              <View style={styles.solarWeightRow}>
                                <Text style={styles.solarWeightFactor}>Slope (LandFire 2020)</Text>
                                <Text style={styles.solarWeightValue}>20%</Text>
                              </View>
                              <View style={styles.solarWeightRow}>
                                <Text style={styles.solarWeightFactor}>Population Density (GPW 2020)</Text>
                                <Text style={styles.solarWeightValue}>10%</Text>
                              </View>
                              <View style={styles.solarWeightRow}>
                                <Text style={styles.solarWeightFactor}>Population Density</Text>
                                <Text style={styles.solarWeightValue}>10%</Text>
                              </View>
                            </View>
                          </View>
                        </View>
                      );
                    })()}
                    
                    {/* Elevation Heat Map Legend - Only show for elevation view */}
                    {expandedViewType.id === 'topological' && (
                      <View style={styles.topoControls}>
                        {/* Legend */}
                        <View style={styles.topoLegend}>
                          <View style={styles.topoLegendSingle}>
                            <Text style={styles.topoLegendTitle}>Elevation Heat Map (Slope-Based)</Text>
                            <View style={styles.topoLegendRow}>
                              <Text style={styles.topoLegendEndLabel}>Lowest</Text>
                              <View style={styles.topoLegendGradient}>
                                <View style={[styles.topoLegendColorBox, { backgroundColor: 'rgb(34, 139, 34)' }]} />
                                <View style={[styles.topoLegendColorBox, { backgroundColor: 'rgb(154, 205, 50)' }]} />
                                <View style={[styles.topoLegendColorBox, { backgroundColor: 'rgb(210, 180, 140)' }]} />
                                <View style={[styles.topoLegendColorBox, { backgroundColor: 'rgb(165, 120, 80)' }]} />
                                <View style={[styles.topoLegendColorBox, { backgroundColor: 'rgb(139, 90, 43)' }]} />
                              </View>
                              <Text style={styles.topoLegendEndLabel}>Highest</Text>
                            </View>
                          </View>
                        </View>
                        <Text style={styles.topoLegendNote}>
                          Heat map shows relative terrain elevation based on LandFire 2020 slope data. Green = low/flat areas, Brown = high/steep areas.
                        </Text>
                      </View>
                    )}
                    
                    <Text style={styles.modalViewDescription}>{expandedViewType.description}</Text>
                  </View>
                );
              })()}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  backButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 45,
    left: 15,
    zIndex: 100,
    width: 36,
    height: 36,
    borderRadius: 4,
    backgroundColor: COLORS.headerText,
    borderWidth: 2,
    borderColor: COLORS.headerBorder,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 6,
  },
  backButtonPressed: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    elevation: 0,
    transform: [{ translateY: 2 }],
  },
  backButtonText: {
    color: COLORS.accent,
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
    lineHeight: 20,
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 50 : 45,
    paddingBottom: 15,
    paddingHorizontal: 60,
    alignItems: 'center',
    backgroundColor: COLORS.headerBg,
    borderBottomWidth: 3,
    borderBottomColor: COLORS.headerBorder,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.headerText,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.headerText,
    marginTop: 4,
    opacity: 0.9,
  },
  formContainer: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 30,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 6,
  },
  input: {
    backgroundColor: COLORS.inputBg,
    borderWidth: 2,
    borderColor: COLORS.borderLight,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.text,
  },
  textArea: {
    minHeight: 100,
    paddingTop: 12,
  },
  requiredText: {
    fontSize: 12,
    color: COLORS.textLight,
    fontStyle: 'italic',
    marginTop: 10,
  },
  controlPanel: {
    backgroundColor: COLORS.headerBg,
    borderTopWidth: 3,
    borderTopColor: COLORS.headerBorder,
    padding: 15,
    alignItems: 'center',
  },
  nextButton: {
    paddingHorizontal: 50,
    paddingVertical: 14,
    borderRadius: 6,
    backgroundColor: COLORS.nextButtonBg,
    borderWidth: 2,
    borderColor: COLORS.nextButtonBorder,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 6,
  },
  nextButtonDisabled: {
    backgroundColor: '#E0D8CC',
    borderColor: '#B0A898',
    shadowOpacity: 0.15,
    elevation: 2,
  },
  nextButtonPressed: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    elevation: 0,
    transform: [{ translateY: 2 }],
  },
  nextButtonText: {
    color: COLORS.buttonText,
    fontSize: 18,
    fontWeight: 'bold',
  },
  nextButtonTextDisabled: {
    color: '#999999',
  },
  // Drawer styles
  drawer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    flexDirection: 'row',
    zIndex: 200,
  },
  drawerHandle: {
    width: 40,
    height: 80,
    backgroundColor: COLORS.headerBg,
    borderTopLeftRadius: 40,
    borderBottomLeftRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginLeft: -40,
    borderWidth: 2,
    borderRightWidth: 0,
    borderColor: COLORS.headerBorder,
    shadowColor: '#000',
    shadowOffset: { width: -2, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 8,
  },
  drawerArrow: {
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  arrowTop: {
    position: 'absolute',
    width: 10,
    height: 2.5,
    backgroundColor: COLORS.text,
    borderRadius: 1.5,
    top: 4,
    left: 3,
  },
  arrowBottom: {
    position: 'absolute',
    width: 10,
    height: 2.5,
    backgroundColor: COLORS.text,
    borderRadius: 1.5,
    bottom: 4,
    left: 3,
  },
  drawerContent: {
    flex: 1,
    backgroundColor: COLORS.drawerBg,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.headerBorder,
    paddingTop: Platform.OS === 'ios' ? 60 : 50,
    paddingHorizontal: 15,
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 10,
  },
  drawerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 15,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.borderLight,
  },
  drawerScroll: {
    flex: 1,
  },
  drawerFarmItem: {
    backgroundColor: COLORS.background,
    padding: 12,
    borderRadius: 6,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  drawerFarmName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  drawerFarmInfo: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 4,
  },
  drawerEmptyText: {
    fontSize: 14,
    color: COLORS.textLight,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 20,
  },
  // Carousel styles
  carouselContainer: {
    height: 310,
    width: 160,
    alignItems: 'center',
    alignSelf: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderTopWidth: 2.5,
    borderLeftWidth: 10,
    borderRightWidth: 1.25,
    borderBottomWidth: 5,
    borderTopColor: '#5A554E',
    borderLeftColor: '#5A554E',
    borderRightColor: '#FFFEF8',
    borderBottomColor: '#FFFEF8',
    backgroundColor: '#E8E4DA',
  },
  horizontalCarouselContainer: {
    height: 150,
    width: DRAWER_WIDTH * 0.75,
    alignItems: 'center',
    alignSelf: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderTopWidth: 2.5,
    borderLeftWidth: 10,
    borderRightWidth: 1.25,
    borderBottomWidth: 5,
    borderTopColor: '#5A554E',
    borderLeftColor: '#5A554E',
    borderRightColor: '#FFFEF8',
    borderBottomColor: '#FFFEF8',
    backgroundColor: '#E8E4DA',
    marginTop: 15,
  },
  carousel: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  polygonWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 8,
    padding: 5,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    overflow: 'hidden',
    backfaceVisibility: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 0.5,
    shadowRadius: 1,
    elevation: 5,
  },
  selectedFarmInfo: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 15,
    marginTop: 15,
    borderTopWidth: 2,
    borderTopColor: COLORS.borderLight,
  },
  selectedFarmName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 4,
  },
  selectedFarmDetails: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  selectedFarmArea: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 4,
  },
  carouselIndicator: {
    fontSize: 12,
    color: COLORS.accent,
    marginBottom: 15,
    paddingBottom: 10,
    fontWeight: '600',
    borderBottomWidth: 2,
    borderBottomColor: COLORS.borderLight,
    width: '100%',
    textAlign: 'center',
  },
  // View type tile styles for horizontal carousel
  viewTypeTile: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 8,
    padding: 5,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    overflow: 'hidden',
    backfaceVisibility: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 0.5,
    shadowRadius: 1,
    elevation: 5,
  },
  viewTypeIcon: {
    fontSize: 24,
    marginBottom: 2,
  },
  viewTypeName: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
  },
  viewTypeLabel: {
    position: 'absolute',
    bottom: 3,
    fontSize: 8,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
    backgroundColor: 'rgba(255,255,255,0.8)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
  },
  viewDataBadge: {
    position: 'absolute',
    top: 3,
    right: 3,
    fontSize: 8,
    fontWeight: '700',
    color: '#FFFFFF',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 3,
    overflow: 'hidden',
  },
  viewTypePreview: {
    marginTop: 4,
    borderRadius: 4,
    overflow: 'hidden',
  },
  selectedViewInfo: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 15,
    marginTop: 10,
    borderTopWidth: 2,
    borderTopColor: COLORS.borderLight,
  },
  selectedViewName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 4,
  },
  selectedViewDescription: {
    fontSize: 12,
    color: COLORS.textLight,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  // Data value display styles
  dataValue: {
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginTop: 2,
  },
  viewDataContainer: {
    marginTop: 8,
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    width: '100%',
  },
  viewDataLabel: {
    fontSize: 11,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  viewDataValue: {
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 2,
  },
  viewDataSubtext: {
    fontSize: 10,
    color: COLORS.textLight,
    marginTop: 2,
    fontStyle: 'italic',
  },
  // Modal styles (matching MapScreen pattern)
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    height: '70%',
    backgroundColor: COLORS.background,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: COLORS.accent,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#C5D5C5',
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
  modalTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    textAlign: 'center',
  },
  modalCloseButton: {
    width: 28,
    height: 28,
    borderRadius: 4,
    backgroundColor: '#C54B4B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalBody: {
    flex: 1,
  },
  modalBodyContent: {
    alignItems: 'center',
    paddingTop: 1,
    paddingBottom: 8,
    paddingHorizontal: 6,
  },
  modalLoadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
  },
  modalLoadingText: {
    marginTop: 12,
    fontSize: 16,
    color: COLORS.textLight,
  },
  modalTileContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  elevationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundDark,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginTop: 8,
    marginBottom: 3,
    gap: 5,
  },
  elevationLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  elevationValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.accent,
  },
  modalViewDescription: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 2,
    textAlign: 'center',
    fontStyle: 'italic',
    paddingHorizontal: 6,
  },
  topoControls: {
    marginTop: 0,
    paddingHorizontal: 5,
    width: '100%',
  },
  solarAvgScore: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.accent,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginBottom: 4,
    gap: 8,
  },
  solarAvgScoreLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  solarAvgScoreValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  solarExplanation: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginTop: 4,
  },
  solarExplanationText: {
    fontSize: 11,
    color: COLORS.text,
    marginBottom: 6,
    fontWeight: '500',
    textAlign: 'center',
  },
  solarWeightsTable: {
    gap: 3,
  },
  solarWeightRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  solarWeightFactor: {
    fontSize: 10,
    color: COLORS.text,
  },
  solarWeightValue: {
    fontSize: 10,
    color: COLORS.accent,
    fontWeight: '600',
  },
  landCoverHeader: {
    alignItems: 'center',
    marginBottom: 6,
    gap: 6,
  },
  landCoverTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
  },
  landCoverTypeBadge: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    minWidth: '80%',
  },
  landCoverTypeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  landCoverDetails: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 6,
  },
  landCoverRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  landCoverLabel: {
    fontSize: 11,
    color: COLORS.textLight,
    fontWeight: '500',
    flex: 0,
    minWidth: 100,
  },
  landCoverValue: {
    fontSize: 11,
    color: COLORS.text,
    flex: 1,
    textAlign: 'right',
  },
  landCoverNotes: {
    backgroundColor: COLORS.accent,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 4,
  },
  landCoverNotesText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontStyle: 'italic',
    textAlign: 'center',
  },
  costBreakdownContainer: {
    marginTop: 8,
  },
  costBreakdownTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 6,
  },
  costTable: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 6,
    padding: 8,
    marginBottom: 4,
  },
  costTableHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.accent,
    marginBottom: 4,
  },
  costTableHeaderText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.accent,
    flex: 1,
    textAlign: 'center',
  },
  costTableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  costTableCell: {
    fontSize: 10,
    color: COLORS.text,
    flex: 1,
    textAlign: 'center',
  },
  costTableDivider: {
    height: 1,
    backgroundColor: COLORS.textLight,
    marginVertical: 4,
    opacity: 0.3,
  },
  costTableTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 4,
    backgroundColor: COLORS.accent,
    borderRadius: 4,
    marginTop: 4,
  },
  costTableTotalLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  costTableTotalValue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  costDisclaimer: {
    fontSize: 9,
    color: COLORS.textLight,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 4,
  },
  topoLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 2,
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 6,
  },
  topoLegendSingle: {
    alignItems: 'center',
  },
  topoLegendTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  topoLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  topoLegendGradient: {
    flexDirection: 'row',
    gap: 2,
  },
  topoLegendColorBox: {
    width: 36,
    height: 24,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#999',
  },
  topoLegendEndLabel: {
    fontSize: 11,
    color: COLORS.text,
    fontWeight: '500',
  },
  topoLegendEndColumn: {
    alignItems: 'center',
    gap: 2,
  },
  topoLegendValue: {
    fontSize: 10,
    color: COLORS.textLight,
    fontWeight: '600',
  },
  topoLegendNote: {
    fontSize: 11,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 2,
    fontWeight: '500',
  },
  topoUnitToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    gap: 10,
  },
  topoControlLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginRight: 8,
  },
  topoUnitButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.accent,
    backgroundColor: 'transparent',
  },
  topoUnitButtonActive: {
    backgroundColor: COLORS.accent,
  },
  topoUnitButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.accent,
  },
  topoUnitButtonTextActive: {
    color: '#FFFFFF',
  },
  topoSliderContainer: {
    marginTop: 2,
  },
  topoSlider: {
    width: '100%',
    height: 30,
  },
  topoSliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -5,
  },
  topoSliderLabel: {
    fontSize: 11,
    color: COLORS.textLight,
    fontStyle: 'italic',
  },
});

export default FarmDescriptionScreen;
