import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Pressable,
  Platform,
  Image,
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
import { buildApiUrl } from '../config/apiConfig';

// Solar suitability data cache (pre-populated by backend batch fetch in MapScreen)
// Data is fetched when farm is built, not on-demand during rendering
const SOLAR_GRID_SPACING = 0.000667; // degrees between points in 30x30 grid
export const SOLAR_DATA_CACHE = new Map(); // Cache for pre-fetched data points

// Dev-only: probe external connectivity for map/satellite assets.
const runNetworkProbe = async () => {
  const leafletUrl = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  const esriTileUrl = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/0/0/0';
  try {
    const res = await fetch(leafletUrl, { method: 'GET' });
    console.log('[NetProbe] Leaflet fetch:', res.status, res.ok);
  } catch (e) {
    console.error('[NetProbe] Leaflet fetch failed:', e?.message || e);
  }
  try {
    const ok = await Image.prefetch(esriTileUrl);
    console.log('[NetProbe] ESRI tile prefetch:', ok);
  } catch (e) {
    console.error('[NetProbe] ESRI tile prefetch failed:', e?.message || e);
  }
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

const formatUsd = (value) => {
  if (value === null || value === undefined) return 'Unknown';
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 'Unknown';
  return `$${Math.round(num).toLocaleString()}`;
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
// NOTE: Deleted getSolarColor function - all farms now use backend-calculated colors

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
  const score = Number(landCoverScore);
  if (!Number.isFinite(score) || score < 1) {
    return {
      type: 'Unknown / Not Yet Analyzed',
      nlcdClasses: 'N/A',
      description: 'Land cover data not available yet',
      clearingCost: 'Unknown',
      costLevel: 'high',
      notes: 'This farm does not currently have land cover analysis. Ensure the backend server is running and re-open the farm to regenerate analysis.'
    };
  }

  // Based on Michigan EGLE Solar Energy Suitability Tool methodology
  // Reference: src/data/egle_scoring_methodology.json
  
  // Score 90: Barren Land, Grassland/Herbaceous, Pasture/Hay, Cultivated Crops (NLCD 31, 71, 81, 82)
  if (score >= 88) {
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
  else if (score >= 73) {
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
  else if (score >= 48) {
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
  else if (score >= 23) {
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
  else if (score >= 1) {
    return {
      type: 'Water / Wetland / Dense Urban',
      nlcdClasses: 'Water, Wetland, or High-Intensity Development',
      description: 'Unsuitable for solar development',
      clearingCost: 'Not Applicable',
      costLevel: 'high',
      notes: 'May not be developable due to environmental or zoning restrictions'
    };
  }

  // Should be unreachable due to early score validation, but keep a safe default.
  return {
    type: 'Unknown / Not Yet Analyzed',
    nlcdClasses: 'N/A',
    description: 'Land cover data not available yet',
    clearingCost: 'Unknown',
    costLevel: 'high',
    notes: 'This farm does not currently have land cover analysis.'
  };
};

// NOTE: Deleted fake getDetailedSolarScore and getElevationForCoord functions.
// They calculated slope from fake elevation data (only 63 points interpolated across Michigan).
// The real solar suitability data already includes actual slope values from LandFire 2020.
// Solar scores use 100% REAL data: land cover (NLCD 2024), slope (LandFire 2020), 
// transmission lines (EIA 123,473 points), and population (GPW 2020).
// Topological view now uses REAL slope data instead of synthetic sine/cosine waves.

// Get solar suitability data for a coordinate using 30x30 grid
// Uses coordinate-based indexing - no need to load entire dataset
const getSolarForCoord = (lat, lng) => {
  // Round to nearest grid point (0.000667° spacing)
  const latRounded = Math.round(lat / SOLAR_GRID_SPACING) * SOLAR_GRID_SPACING;
  const lngRounded = Math.round(lng / SOLAR_GRID_SPACING) * SOLAR_GRID_SPACING;
  
  // Synchronous lookup from cache only - no background fetching here
  const cacheKey = `${latRounded.toFixed(6)}_${lngRounded.toFixed(6)}`;
  
  if (SOLAR_DATA_CACHE.has(cacheKey)) {
    const data = SOLAR_DATA_CACHE.get(cacheKey);
    if (data === null) {
      return null; // Cached failure - coordinate has no data
    }
    return {
      ...data,
      score: data.overall,
      substation: data.transmission
    };
  }
  
  // Not in cache - caller should trigger fetch explicitly if needed
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
// NOTE: Deleted getAverageSolar function - all farms now use backend-calculated avgSuitability

// Generate contour lines using d3-contour library with REAL LandFire 2020 slope data
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

// NOTE: generateElevationHeatMap removed - all farms now use backend-generated heat maps
// NOTE: generateSolarHeatMap removed - all farms now use backend-generated heat maps
// NOTE: getElevationColorFromNormalized removed - all colors now calculated by backend

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

  // Backend analysis rehydration
  const analysisByFarmIdRef = useRef(new Map());
  const analysisInFlightRef = useRef(new Set());
  const [analysisTick, setAnalysisTick] = useState(0);

  useEffect(() => {
    if (!__DEV__) return;
    // Fire-and-forget so it doesn't block UI.
    setTimeout(() => {
      runNetworkProbe();
    }, 0);
  }, []);
  
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

  const clearCachesForStableFarmId = useCallback((stableFarmId) => {
    if (!stableFarmId) return;
    const viewPrefix = `${stableFarmId}-`;
    Object.keys(viewDataCache.current).forEach((k) => {
      if (k.startsWith(viewPrefix)) delete viewDataCache.current[k];
    });
    Object.keys(tileRenderCache.current).forEach((k) => {
      if (k.startsWith(viewPrefix)) delete tileRenderCache.current[k];
    });
  }, []);

  const getFarmWithHydratedAnalysis = useCallback((farm) => {
    if (!farm?.id) return farm;
    const cached = analysisByFarmIdRef.current.get(farm.id);
    if (!cached) return farm;
    return {
      ...farm,
      backendAnalysis: cached,
    };
  }, [analysisTick]);

  const ensureFarmAnalysis = useCallback(async (farm, options = {}) => {
    const farmId = farm?.id;
    const coords = farm?.geometry?.coordinates?.[0] || [];
    if (!farmId || coords.length < 3) return;

    const force = Boolean(options?.force);

    // If grids exist but landcover report is missing (or errored), allow refresh.
    const needsLandcoverReport =
      !farm?.backendAnalysis?.landcoverReport ||
      (farm?.backendAnalysis?.landcoverReportError && !farm?.backendAnalysis?.landcoverReport);

    // Already has full grids in-memory
    if (!force && farm?.backendAnalysis?.solarHeatMapGrid && farm?.backendAnalysis?.elevationHeatMapGrid && !needsLandcoverReport) return;

    // Already hydrated
    const cached = analysisByFarmIdRef.current.get(farmId);
    const cachedNeedsLandcover =
      !cached?.landcoverReport || (cached?.landcoverReportError && !cached?.landcoverReport);
    if (!force && cached?.solarHeatMapGrid && cached?.elevationHeatMapGrid && !cachedNeedsLandcover) return;

    if (analysisInFlightRef.current.has(farmId)) return;
    analysisInFlightRef.current.add(farmId);

    try {
      const ring = Array.isArray(coords) ? coords.slice() : [];
      if (ring.length >= 1) {
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (!last || first?.[0] !== last?.[0] || first?.[1] !== last?.[1]) {
          ring.push(first);
        }
      }

      const response = await fetch(buildApiUrl('/farms/analyze'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ farmId, coordinates: ring, county, city }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend API error (${response.status}): ${errorText}`);
      }

      const analysis = await response.json();
      const solarOk =
        analysis?.solarHeatMapGrid?.width > 0 &&
        analysis?.solarHeatMapGrid?.height > 0 &&
        Array.isArray(analysis?.solarHeatMapGrid?.cells);
      const elevOk =
        analysis?.elevationHeatMapGrid?.width > 0 &&
        analysis?.elevationHeatMapGrid?.height > 0 &&
        Array.isArray(analysis?.elevationHeatMapGrid?.cells);

      const existingAnalysis =
        analysisByFarmIdRef.current.get(farmId) || farm?.backendAnalysis || null;

      const hasReportKey =
        analysis && Object.prototype.hasOwnProperty.call(analysis, 'landcoverReport');
      const hasErrorKey =
        analysis && Object.prototype.hasOwnProperty.call(analysis, 'landcoverReportError');
      const hasLandcoverUpdate = Boolean(hasReportKey || hasErrorKey);

      if (solarOk && elevOk) {
        // Store full payload, including landcover report if provided.
        analysisByFarmIdRef.current.set(farmId, analysis);
        const stableFarmId = getStableFarmId(farmId, coords);
        clearCachesForStableFarmId(stableFarmId);
        setAnalysisTick((t) => t + 1);
      } else {
        // If the backend returns only the landcover report (or a non-fatal error), persist it even
        // when solar/elevation grids are incomplete. This keeps the Satellite modal useful.
        if (hasLandcoverUpdate) {
          const merged = {
            ...(existingAnalysis || {}),
            ...analysis,
            // Preserve existing grids if the refreshed payload doesn't include valid ones.
            solarHeatMapGrid: solarOk ? analysis.solarHeatMapGrid : existingAnalysis?.solarHeatMapGrid,
            elevationHeatMapGrid: elevOk ? analysis.elevationHeatMapGrid : existingAnalysis?.elevationHeatMapGrid,
          };
          analysisByFarmIdRef.current.set(farmId, merged);
          setAnalysisTick((t) => t + 1);
        }

        console.warn(
          hasLandcoverUpdate
            ? 'Rehydration returned incomplete grids; stored landcover update and kept existing grids.'
            : 'Rehydration returned incomplete grids; keeping placeholder render.',
          {
            farmId,
            solar: analysis?.solarHeatMapGrid
              ? {
                  width: analysis.solarHeatMapGrid.width,
                  height: analysis.solarHeatMapGrid.height,
                  cells: Array.isArray(analysis.solarHeatMapGrid.cells)
                    ? analysis.solarHeatMapGrid.cells.length
                    : null,
                }
              : null,
            elev: analysis?.elevationHeatMapGrid
              ? {
                  width: analysis.elevationHeatMapGrid.width,
                  height: analysis.elevationHeatMapGrid.height,
                  cells: Array.isArray(analysis.elevationHeatMapGrid.cells)
                    ? analysis.elevationHeatMapGrid.cells.length
                    : null,
                }
              : null,
            landcover: {
              hasReportKey,
              hasErrorKey,
              hasReport: Boolean(analysis?.landcoverReport),
              hasError: Boolean(analysis?.landcoverReportError),
            },
          }
        );
      }
    } catch (e) {
      console.error('Failed to rehydrate farm analysis:', e?.message || e);
    } finally {
      analysisInFlightRef.current.delete(farmId);
    }
  }, [county, city, clearCachesForStableFarmId]);
  
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

  // Rehydrate backend analysis on-demand for the currently viewed farm(s)
  useEffect(() => {
    const currentFarm = builtFarms[currentIndex] || farms?.[currentIndex];
    if (currentFarm) ensureFarmAnalysis(currentFarm);
  }, [builtFarms, farms, currentIndex, ensureFarmAnalysis]);

  useEffect(() => {
    if (!expandedModalVisible) return;
    if (expandedFarmIndex === null || expandedFarmIndex === undefined) return;
    const expandedFarm = builtFarms[expandedFarmIndex];
    if (expandedFarm) ensureFarmAnalysis(expandedFarm);
  }, [expandedModalVisible, expandedFarmIndex, builtFarms, ensureFarmAnalysis]);
  
  // Form state
  const [selectedFarmIds, setSelectedFarmIds] = useState([]);
  const [farmDropdownOpen, setFarmDropdownOpen] = useState(false);
  const [siteIncludes, setSiteIncludes] = useState(''); // 'farming', 'grazing', or 'neither'
  // Rotation selection state
  const [rotationFarmId, setRotationFarmId] = useState(null);
  const [rotationFarmDropdownOpen, setRotationFarmDropdownOpen] = useState(false);
  const [rotationDropdownOpen, setRotationDropdownOpen] = useState(false);
  const [rotationSearch, setRotationSearch] = useState('');
  const [cropOptions, setCropOptions] = useState([]);
  const [cropOptionsLoading, setCropOptionsLoading] = useState(false);
  const [cropOptionsError, setCropOptionsError] = useState('');
  // rotationByFarmId[farmId] = { cropIds: number[] }
  const [rotationByFarmId, setRotationByFarmId] = useState({});
  const [rotationDraftByFarmId, setRotationDraftByFarmId] = useState({});

  // Other form fields (restored)
  const [farmType, setFarmType] = useState('');
  const [acreage, setAcreage] = useState('');
  const [primaryCrops, setPrimaryCrops] = useState('');
  const [soilType, setSoilType] = useState('');
  const [irrigationType, setIrrigationType] = useState('');
  const [notes, setNotes] = useState('');

  const isFormValid = selectedFarmIds.length > 0 && siteIncludes !== '';

  const toggleFarmSelection = (farmId) => {
    setSelectedFarmIds(prev => 
      prev.includes(farmId) 
        ? prev.filter(id => id !== farmId)
        : [...prev, farmId]
    );
  };

  const selectSiteInclude = (option) => {
    setSiteIncludes(option);
  };

  // Keep rotationFarmId pointed at a selected farm
  useEffect(() => {
    if (selectedFarmIds.length === 0) {
      setRotationFarmId(null);
      return;
    }
    if (rotationFarmId && selectedFarmIds.includes(rotationFarmId)) return;
    setRotationFarmId(selectedFarmIds[0]);
  }, [selectedFarmIds, rotationFarmId]);

  // Seed draft state from saved state when changing selected rotation farm
  useEffect(() => {
    if (!rotationFarmId) return;
    setRotationDraftByFarmId((prev) => {
      if (prev[rotationFarmId]) return prev;
      const saved = rotationByFarmId?.[rotationFarmId];
      return {
        ...prev,
        [rotationFarmId]: { cropIds: Array.isArray(saved?.cropIds) ? saved.cropIds : [] },
      };
    });
  }, [rotationFarmId, rotationByFarmId]);

  // Load crop options (for searchable dropdown)
  useEffect(() => {
    let cancelled = false;

    const loadCrops = async () => {
      setCropOptionsLoading(true);
      setCropOptionsError('');
      try {
        const response = await fetch(buildApiUrl('/crops'));
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Backend API error (${response.status}): ${text}`);
        }
        const data = await response.json();
        const crops = Array.isArray(data?.crops) ? data.crops : [];
        if (!cancelled) setCropOptions(crops);
      } catch (e) {
        if (!cancelled) setCropOptionsError(e?.message || 'Failed to load crops');
      } finally {
        if (!cancelled) setCropOptionsLoading(false);
      }
    };

    loadCrops();
    return () => {
      cancelled = true;
    };
  }, []);

  const getFarmLabel = useCallback((farmId) => {
    const farm = builtFarms.find((f) => f?.id === farmId);
    return farm?.properties?.name || (farm ? `Farm ${builtFarms.indexOf(farm) + 1}` : 'Farm');
  }, [builtFarms]);

  const rotationDraft = rotationFarmId ? rotationDraftByFarmId?.[rotationFarmId] : null;
  const rotationDraftCropIds = Array.isArray(rotationDraft?.cropIds) ? rotationDraft.cropIds : [];

  const toggleRotationCrop = useCallback((cropId) => {
    if (!rotationFarmId) return;

    setRotationDraftByFarmId((prev) => {
      const current = prev?.[rotationFarmId];
      const existingIds = Array.isArray(current?.cropIds) ? current.cropIds : [];
      const nextIds = existingIds.includes(cropId)
        ? existingIds.filter((id) => id !== cropId)
        : [...existingIds, cropId];
      return {
        ...prev,
        [rotationFarmId]: { cropIds: nextIds },
      };
    });
  }, [rotationFarmId]);

  const setNoRotationForFarm = useCallback(() => {
    if (!rotationFarmId) return;
    setRotationDraftByFarmId((prev) => ({
      ...prev,
      [rotationFarmId]: { cropIds: [] },
    }));
  }, [rotationFarmId]);

  const saveRotationForCurrentFarm = useCallback(() => {
    if (!rotationFarmId) return;
    setRotationByFarmId((prev) => ({
      ...prev,
      [rotationFarmId]: { cropIds: rotationDraftCropIds },
    }));
  }, [rotationFarmId, rotationDraftCropIds]);

  const filteredCropOptions = useMemo(() => {
    const term = rotationSearch.trim().toLowerCase();
    if (!term) return cropOptions;
    return cropOptions.filter((c) => {
      const name = String(c?.name || '').toLowerCase();
      const crop = String(c?.crop || '').toLowerCase();
      const category = String(c?.category || '').toLowerCase();
      return name.includes(term) || crop.includes(term) || category.includes(term);
    });
  }, [cropOptions, rotationSearch]);

  // Get or compute cached view data for a farm
  const getViewData = useCallback((farmId, coords, tileSize, options = {}) => {
    const includeSolarStats = options.includeSolarStats ?? false;
    const farm = options.farm; // Pass farm object to access backendAnalysis
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

    const padding = tileSize * 0.1;
    const availableSize = tileSize - padding * 2;

    const backendElevGrid = farm?.backendAnalysis?.elevationHeatMapGrid;
    const elevGridWidth = backendElevGrid?.width > 0 ? backendElevGrid.width : 30;
    const elevGridHeight = backendElevGrid?.height > 0 ? backendElevGrid.height : 30;
    const elevCellPixelWidth = availableSize / elevGridWidth;
    const elevCellPixelHeight = availableSize / elevGridHeight;

    const elevationHeatMap = backendElevGrid?.cells
      ? backendElevGrid.cells.map((cell) => ({
          x: padding + (cell.col * elevCellPixelWidth),
          y: padding + ((backendElevGrid.height - cell.row - 1) * elevCellPixelHeight),
          width: elevCellPixelWidth + 0.5,
          height: elevCellPixelHeight + 0.5,
          slope: cell.slope,
          color: cell.color,
        }))
      : [];

    if (backendElevGrid?.width > 0 && backendElevGrid?.height > 0) {
      console.log(`Backend elevation: ${backendElevGrid.width}x${backendElevGrid.height}, ${elevationHeatMap.length} cells`);
    }
    
    // Contour lines (uses real slope from LandFire 2020)
    const contourLines = generateContourLines(coords, tileSize, 5); // 5% slope interval
    
    const backendGrid = farm?.backendAnalysis?.solarHeatMapGrid;
    const avgSuitability = farm?.backendAnalysis?.metadata?.avgSuitability ?? 0;

    const solarGridWidth = backendGrid?.width > 0 ? backendGrid.width : 30;
    const solarGridHeight = backendGrid?.height > 0 ? backendGrid.height : 30;
    const solarCellPixelWidth = availableSize / solarGridWidth;
    const solarCellPixelHeight = availableSize / solarGridHeight;

    const cells = backendGrid?.cells
      ? backendGrid.cells.map((cell) => ({
          key: `solar-${cell.row}-${cell.col}`,
          x: padding + (cell.col * solarCellPixelWidth),
          y: padding + ((backendGrid.height - cell.row - 1) * solarCellPixelHeight),
          width: solarCellPixelWidth + 0.5,
          height: solarCellPixelHeight + 0.5,
          color: cell.color,
          score: cell.score,
        }))
      : [];

    const solarHeatMap = {
      cells,
      stats: includeSolarStats
        ? {
            avg: avgSuitability,
            min: backendGrid?.cells?.length ? Math.min(...backendGrid.cells.map((c) => c.score)) : 0,
            max: backendGrid?.cells?.length ? Math.max(...backendGrid.cells.map((c) => c.score)) : 0,
            count: backendGrid?.cells?.length ?? 0,
          }
        : null,
    };

    const avgSolar = { score: avgSuitability, overall: avgSuitability };
    const solarColor = getSolarGradientColorForScore(avgSuitability);

    if (backendGrid?.width > 0 && backendGrid?.height > 0) {
      console.log(`Backend solar: ${backendGrid.width}x${backendGrid.height}, ${cells.length} cells, avg=${avgSuitability}`);
    }
    
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
    
    const satellitePadding = tileSize * 0.1;
    const satelliteAvailableSize = tileSize - satellitePadding * 2;
    
    const geoWidth = bounds.maxLng - bounds.minLng || 0.0001;
    const geoHeight = bounds.maxLat - bounds.minLat || 0.0001;
    const scale = Math.min(satelliteAvailableSize / geoWidth, satelliteAvailableSize / geoHeight);
    
    const geoCenterLng = (bounds.minLng + bounds.maxLng) / 2;
    const geoCenterLat = (bounds.minLat + bounds.maxLat) / 2;
    
    const lngLatToPixel = (lng, lat) => {
      const x = satellitePadding + (lng - geoCenterLng) * scale + satelliteAvailableSize / 2;
      const y = satellitePadding + (geoCenterLat - lat) * scale + satelliteAvailableSize / 2;
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
          url: `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`,
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
    const effectiveRotationsByFarmId = { ...rotationByFarmId };
    // Merge draft rotations for selected farms so the latest selections aren't dropped.
    selectedFarmIds.forEach((farmId) => {
      const draft = rotationDraftByFarmId?.[farmId];
      if (!draft) return;
      const cropIds = Array.isArray(draft.cropIds) ? draft.cropIds : [];
      effectiveRotationsByFarmId[farmId] = { cropIds };
    });

    const farmDescription = {
      selectedFarmIds,
      rotationsByFarmId: effectiveRotationsByFarmId,
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
        <Text style={styles.headerTitle}>Define Your Solar Site</Text>
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
          {/* Select Farms */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Select Farm(s) *</Text>
            <Pressable 
              style={styles.dropdownButton}
              onPress={() => setFarmDropdownOpen(!farmDropdownOpen)}
            >
              <Text style={styles.dropdownButtonText}>
                {selectedFarmIds.length === 0 
                  ? 'Select farms...'
                  : `${selectedFarmIds.length} farm${selectedFarmIds.length > 1 ? 's' : ''} selected`
                }
              </Text>
              <Text style={styles.dropdownArrow}>{farmDropdownOpen ? '▲' : '▼'}</Text>
            </Pressable>
            {farmDropdownOpen && (
              <ScrollView style={styles.dropdownList} nestedScrollEnabled={true}>
                {builtFarms.length === 0 ? (
                  <Text style={styles.dropdownEmptyText}>No farms built yet</Text>
                ) : (
                  builtFarms.map((farm) => (
                    <Pressable
                      key={farm.id}
                      style={styles.dropdownItem}
                      onPress={() => toggleFarmSelection(farm.id)}
                    >
                      <View style={styles.checkbox}>
                        {selectedFarmIds.includes(farm.id) && (
                          <Text style={styles.checkmark}>✓</Text>
                        )}
                      </View>
                      <Text style={styles.dropdownItemText}>
                        {farm.properties?.name || `Farm ${builtFarms.indexOf(farm) + 1}`}
                      </Text>
                    </Pressable>
                  ))
                )}
              </ScrollView>
            )}
          </View>

          {/* Will your site include */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Will your site include: *</Text>
            <View style={styles.checkboxGroup}>
              <Pressable
                style={styles.checkboxOption}
                onPress={() => selectSiteInclude('farming')}
              >
                <View style={styles.checkbox}>
                  {siteIncludes === 'farming' && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </View>
                <Text style={styles.checkboxLabel}>Farming</Text>
              </Pressable>

              <Pressable
                style={styles.checkboxOption}
                onPress={() => selectSiteInclude('grazing')}
              >
                <View style={styles.checkbox}>
                  {siteIncludes === 'grazing' && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </View>
                <Text style={styles.checkboxLabel}>Grazing</Text>
              </Pressable>

              <Pressable
                style={styles.checkboxOption}
                onPress={() => selectSiteInclude('neither')}
              >
                <View style={styles.checkbox}>
                  {siteIncludes === 'neither' && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </View>
                <Text style={styles.checkboxLabel}>Neither</Text>
              </Pressable>
            </View>
          </View>

          {/* Conditional Forms based on selection */}
          {siteIncludes === 'farming' && (
            <>
              {/* Select Rotation (replaces Farm Type) */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Select Rotation</Text>

                <Text style={styles.subLabel}>Choose farm</Text>
                <Pressable
                  style={[styles.dropdownButton, selectedFarmIds.length === 0 && styles.dropdownButtonDisabled]}
                  onPress={() => {
                    if (selectedFarmIds.length === 0) return;
                    setRotationFarmDropdownOpen(!rotationFarmDropdownOpen);
                  }}
                >
                  <Text style={styles.dropdownButtonText}>
                    {rotationFarmId ? getFarmLabel(rotationFarmId) : 'Select a farm...'}
                  </Text>
                  <Text style={styles.dropdownArrow}>{rotationFarmDropdownOpen ? '▲' : '▼'}</Text>
                </Pressable>

                {rotationFarmDropdownOpen && (
                  <ScrollView style={styles.dropdownList} nestedScrollEnabled={true}>
                    {selectedFarmIds.map((farmId) => (
                      <Pressable
                        key={farmId}
                        style={styles.dropdownItem}
                        onPress={() => {
                          setRotationFarmId(farmId);
                          setRotationFarmDropdownOpen(false);
                          setRotationDropdownOpen(false);
                          setRotationSearch('');
                        }}
                      >
                        <View style={styles.checkbox}>
                          {rotationFarmId === farmId && <Text style={styles.checkmark}>✓</Text>}
                        </View>
                        <Text style={styles.dropdownItemText}>{getFarmLabel(farmId)}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}

                <Text style={[styles.subLabel, { marginTop: 12 }]}>Rotation crops (optional)</Text>
                <Pressable
                  style={[styles.dropdownButton, !rotationFarmId && styles.dropdownButtonDisabled]}
                  onPress={() => {
                    if (!rotationFarmId) return;
                    setRotationDropdownOpen(!rotationDropdownOpen);
                  }}
                >
                  <Text style={styles.dropdownButtonText}>
                    {!rotationFarmId
                      ? 'Select a farm first...'
                      : rotationDraftCropIds.length === 0
                        ? 'No rotation'
                        : `${rotationDraftCropIds.length} crop${rotationDraftCropIds.length > 1 ? 's' : ''} selected`}
                  </Text>
                  <Text style={styles.dropdownArrow}>{rotationDropdownOpen ? '▲' : '▼'}</Text>
                </Pressable>

                {rotationDropdownOpen && (
                  <View style={styles.dropdownList}>
                    <TextInput
                      style={styles.dropdownSearchInput}
                      value={rotationSearch}
                      onChangeText={setRotationSearch}
                      placeholder="Search crops..."
                      placeholderTextColor={COLORS.placeholder}
                    />

                    <Pressable
                      style={styles.dropdownItem}
                      onPress={() => setNoRotationForFarm()}
                    >
                      <View style={styles.checkbox}>
                        {rotationDraftCropIds.length === 0 && <Text style={styles.checkmark}>✓</Text>}
                      </View>
                      <Text style={styles.dropdownItemText}>No rotation</Text>
                    </Pressable>

                    {cropOptionsLoading ? (
                      <View style={styles.dropdownLoadingRow}>
                        <ActivityIndicator size="small" color={COLORS.accent} />
                        <Text style={styles.dropdownEmptyText}>Loading crops…</Text>
                      </View>
                    ) : cropOptionsError ? (
                      <Text style={styles.dropdownEmptyText}>{cropOptionsError}</Text>
                    ) : filteredCropOptions.length === 0 ? (
                      <Text style={styles.dropdownEmptyText}>No crops found</Text>
                    ) : (
                      <ScrollView style={styles.dropdownInnerScroll} nestedScrollEnabled={true}>
                        {filteredCropOptions.map((crop) => (
                          <Pressable
                            key={crop.id}
                            style={styles.dropdownItem}
                            onPress={() => toggleRotationCrop(crop.id)}
                          >
                            <View style={styles.checkbox}>
                              {rotationDraftCropIds.includes(crop.id) && <Text style={styles.checkmark}>✓</Text>}
                            </View>
                            <Text style={styles.dropdownItemText}>{crop.name}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                )}

                <Pressable
                  style={[styles.rotationSaveButton, !rotationFarmId && styles.nextButtonDisabled]}
                  onPress={saveRotationForCurrentFarm}
                  disabled={!rotationFarmId}
                >
                  <Text style={styles.rotationSaveButtonText}>Save rotation for this farm</Text>
                </Pressable>
              </View>
            </>
          )}

          {siteIncludes === 'grazing' && (
            <>
              {/* Grazing Type */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Grazing Type *</Text>
                <TextInput
                  style={styles.input}
                  value={farmType}
                  onChangeText={setFarmType}
                  placeholder="e.g., Rotational, Continuous, Intensive"
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

              {/* Livestock Type */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Livestock Type</Text>
                <TextInput
                  style={styles.input}
                  value={primaryCrops}
                  onChangeText={setPrimaryCrops}
                  placeholder="e.g., Cattle, Sheep, Goats"
                  placeholderTextColor={COLORS.placeholder}
                />
              </View>

              {/* Pasture Type */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Pasture Type</Text>
                <TextInput
                  style={styles.input}
                  value={soilType}
                  onChangeText={setSoilType}
                  placeholder="e.g., Native, Improved, Mixed"
                  placeholderTextColor={COLORS.placeholder}
                />
              </View>

              {/* Water Source */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Water Source</Text>
                <TextInput
                  style={styles.input}
                  value={irrigationType}
                  onChangeText={setIrrigationType}
                  placeholder="e.g., Pond, Well, Stream"
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
                  placeholder="Any additional information about your grazing operation"
                  placeholderTextColor={COLORS.placeholder}
                  multiline={true}
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>
            </>
          )}

          {(siteIncludes === 'farming' || siteIncludes === 'grazing' || siteIncludes === 'neither') && (
            <Text style={styles.requiredText}>* Required fields</Text>
          )}
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
                {(() => {
                  const currentFarm = builtFarms[currentIndex] || null;
                  const coords = currentFarm?.geometry?.coordinates?.[0] || [];
                  const { acres, sqMiles } = calculatePolygonArea(coords);
                  const pinCount = currentFarm?.pins?.length ?? currentFarm?.properties?.pinCount ?? 0;

                  return (
                    <>
                <Text style={styles.selectedFarmName}>
                      {currentFarm?.properties?.name || `Farm ${currentIndex + 1}`}
                </Text>
                <Text style={styles.selectedFarmDetails}>
                      {pinCount} pins
                </Text>
                    <Text style={styles.selectedFarmArea}>
                      {(acres ?? 0).toFixed(2)} acres ({(sqMiles ?? 0).toFixed(4)} sq mi)
                    </Text>
                <Text style={styles.carouselIndicator}>
                      {currentIndex + 1} / {builtFarms.length}
                </Text>
                    </>
                  );
                })()}
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
                    const baseFarm = builtFarms[currentIndex] || farms[currentIndex] || null;
                    const currentFarm = getFarmWithHydratedAnalysis(baseFarm);
                    const coords = currentFarm?.geometry?.coordinates?.[0] || [];
                    const stableFarmId = getStableFarmId(currentFarm?.id, coords);
                    
                    if (!currentFarm || coords.length === 0) {
                      return <View style={[styles.viewTypeTile, { width: tileSize, height: tileSize }]} />;
                    }
                    
                    // Get cached view data (computed only once per farm)
                    const viewData = getViewData(currentFarm.id, coords, tileSize - 10, { farm: currentFarm });
                    const { bounds, polygonPoints, contourLines, elevationHeatMap, avgSolar, solarColor, tiles, solarHeatMap } = viewData;
                    const solarCells = solarHeatMap?.cells || [];
                    
                    // Use stable clip IDs to avoid collisions when farm.id is missing
                    const clipIdBase = `${stableFarmId}-${viewType.id}`;
                    
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
              {(() => {
                const baseFarm =
                  expandedFarmIndex !== null && builtFarms[expandedFarmIndex]
                    ? builtFarms[expandedFarmIndex]
                    : null;
                const currentFarm = baseFarm ? getFarmWithHydratedAnalysis(baseFarm) : null;
                const refreshDisabled = !currentFarm || modalLoading;

                return (
                  <Pressable
                    accessibilityLabel="Refresh"
                    style={({ pressed }) => [
                      styles.modalHeaderIconButton,
                      pressed && styles.buttonPressed,
                      refreshDisabled && { opacity: 0.6 },
                    ]}
                    disabled={refreshDisabled}
                    onPress={async () => {
                      if (!currentFarm) return;
                      setModalLoading(true);
                      try {
                        await ensureFarmAnalysis(currentFarm, { force: true });
                      } finally {
                        setModalLoading(false);
                      }
                    }}
                  >
                    {modalLoading ? (
                      <ActivityIndicator size="small" color={COLORS.text} />
                    ) : (
                      <Text style={styles.modalHeaderIconText}>↻</Text>
                    )}
                  </Pressable>
                );
              })()}
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

                const currentFarm = getFarmWithHydratedAnalysis(builtFarms[expandedFarmIndex]);
                const coords = currentFarm?.geometry?.coordinates?.[0] || [];
                // Make tile larger since it's the only one displayed
                const screenWidth = Dimensions.get('window').width;
                const screenHeight = Dimensions.get('window').height;
                const expandedTileSize = Math.min(screenWidth * 0.7, screenHeight * 0.5, 350);
                
                // Get cached view data for the expanded tile size
                const viewData = getViewData(currentFarm.id, coords, expandedTileSize, { includeSolarStats: true, farm: currentFarm });
                const { bounds, polygonPoints, contourLines, elevationHeatMap, avgSolar, solarColor, tiles, lngLatToPixel, availableSize, solarHeatMap } = viewData;
                const solarCells = solarHeatMap?.cells || [];
                const solarStats = solarHeatMap?.stats;
                
                // Use stable clip IDs to avoid collisions when farm.id is missing
                const stableFarmId = getStableFarmId(currentFarm?.id, coords);
                const clipIdBase = `${stableFarmId}-expanded`;
                
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
                    
                    {/* Land Cover Report - Only show for satellite view */}
                    {expandedViewType.id === 'satellite' && (() => {
                      const report = currentFarm?.backendAnalysis?.landcoverReport;
                      const reportError = currentFarm?.backendAnalysis?.landcoverReportError;
                      const nlcdClasses = Array.isArray(report?.nlcd?.classes) ? report.nlcd.classes : [];
                      const topClasses = nlcdClasses
                        .slice()
                        .sort((a, b) => ((b?.percent ?? b?.percentOfFarm) ?? 0) - ((a?.percent ?? a?.percentOfFarm) ?? 0))
                        .slice(0, 3);

                      const waterCoverageByTable = Array.isArray(report?.water?.coveragePercentByTable)
                        ? report.water.coveragePercentByTable
                        : [];

                      const additionalCoverageByTable = Array.isArray(report?.layers?.coveragePercentByTable)
                        ? report.layers.coveragePercentByTable
                        : [];

                      const estimatedTotalUsd = report?.sitePrepCost?.estimatedTotalUsd;
                      const estimatedPerAcreUsd = report?.sitePrepCost?.estimatedPerAcreUsd;
                      const waterPercent = report?.nlcd?.waterPercent;

                      const sortedCoverageRows = (() => {
                        const rows = [];

                        rows.push({
                          key: 'open-water',
                          label: 'Open Water (NLCD 11)',
                          value: `${(waterPercent ?? 0).toFixed(1)}%`,
                        });

                        if (waterCoverageByTable.length > 0) {
                          waterCoverageByTable.forEach((row) => {
                            const rawName = row?.table ?? row?.table_name ?? 'unknown';
                            const label = String(rawName).replace(/^landcover_/, '').replace(/_/g, ' ');
                            rows.push({
                              key: `water-table-${rawName}`,
                              label,
                              value: `${(row?.percent ?? 0).toFixed(1)}%`,
                            });
                          });
                        } else {
                          rows.push({
                            key: 'water-none',
                            label: 'Water layers',
                            value: 'Not available',
                          });
                        }

                        if (additionalCoverageByTable.length > 0) {
                          additionalCoverageByTable.forEach((row) => {
                            const rawName = row?.table ?? row?.table_name ?? 'unknown';
                            const label = String(rawName).replace(/^landcover_/, '').replace(/_/g, ' ');
                            rows.push({
                              key: `layer-table-${rawName}`,
                              label,
                              value: `${(row?.percent ?? 0).toFixed(1)}%`,
                            });
                          });
                        } else {
                          rows.push({
                            key: 'layers-none',
                            label: 'Other layers',
                            value: 'Not available',
                          });
                        }

                        return rows.sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { sensitivity: 'base' }));
                      })();

                      const pricingEquations = report?.sitePrepCost?.equations || null;
                      const allEquationRows = Array.isArray(pricingEquations?.equations)
                        ? pricingEquations.equations
                        : [];
                      const preferredEquationIds = new Set([
                        'msuCostUsd',
                        'mdotDevelopedItems',
                        'mdotVegetationItems',
                        'pricedAreaAcres',
                        'estimatedTotalUsd',
                        'estimatedPerAcreUsd',
                      ]);
                      const preferredEquationRows = allEquationRows.filter((e) => preferredEquationIds.has(e?.id));
                      const equationRowsToShow = (preferredEquationRows.length > 0 ? preferredEquationRows : allEquationRows).slice(0, 8);
                      const equationText = equationRowsToShow
                        .filter((e) => e && e.equation)
                        .map((e) => `${e.id ? `${e.id}: ` : ''}${e.equation}`)
                        .join('\n');

                      const sources = report?.sitePrepCost?.pricingSnapshot?.sources || null;
                      const eiaUrl = sources?.eia?.sourceUrl || sources?.eia?.apiUrl || null;
                      const msuUrl = sources?.msu?.url || null;
                      const msuTitle = sources?.msu?.title || null;
                      const mdotUrl = sources?.mdot?.url || null;

                      return (
                        <View style={styles.topoControls}>
                          <View style={styles.landCoverHeader}>
                            <Text style={styles.landCoverTitle}>NLCD 2024 Land Cover</Text>
                            <Text style={[styles.landCoverSubtitle, { fontSize: 11, color: '#059669', marginTop: 2, fontWeight: '600' }]}>
                              Live landcover + Michigan pricing sources
                            </Text>
                          </View>

                          {!report && (
                            <View style={styles.landCoverDetails}>
                              <View style={styles.landCoverRow}>
                                <Text style={styles.landCoverLabel}>Land cover:</Text>
                                <Text style={styles.landCoverValue}>Land cover data not available yet</Text>
                              </View>
                              <View style={styles.landCoverRow}>
                                <Text style={styles.landCoverLabel}>Clearing Cost:</Text>
                                <Text style={styles.landCoverValue}>Clearing Cost Unknown</Text>
                              </View>
                              {reportError?.message && (
                                <View style={styles.landCoverRow}>
                                  <Text style={styles.landCoverLabel}>Status:</Text>
                                  <Text style={styles.landCoverValue}>{reportError.message}</Text>
                                </View>
                              )}
                            </View>
                          )}

                          {report && (
                            <>
                              {/* Estimated site-prep at the top */}
                              <View style={styles.landCoverDetails}>
                                <View style={styles.landCoverRow}>
                                  <Text style={styles.landCoverLabel}>Estimated site prep:</Text>
                                  <Text style={styles.landCoverValue}>{formatUsd(estimatedTotalUsd)}</Text>
                                </View>
                                <View style={styles.landCoverRow}>
                                  <Text style={styles.landCoverLabel}>Per acre:</Text>
                                  <Text style={styles.landCoverValue}>{formatUsd(estimatedPerAcreUsd)}</Text>
                                </View>
                              </View>

                              {/* Percentages in blue box, with Top classes first (multiline) */}
                              <View style={styles.landCoverPercentagesBox}>
                                <View style={styles.landCoverRow}>
                                  <Text style={[styles.landCoverLabel, styles.landCoverBoxLabel]}>Top classes:</Text>
                                  <Text style={[styles.landCoverValue, styles.landCoverBoxValue, styles.landCoverValueMultiline]}>
                                    {topClasses.length > 0
                                      ? topClasses
                                          .map((c) => `${c.name} (${(((c.percent ?? c.percentOfFarm) ?? 0)).toFixed(1)}%)`)
                                          .join('\n')
                                      : 'No NLCD classes returned'}
                                  </Text>
                                </View>

                                {sortedCoverageRows.map((row) => (
                                  <View key={row.key} style={styles.landCoverRow}>
                                    <Text style={[styles.landCoverLabel, styles.landCoverBoxLabel]}>{row.label}:</Text>
                                    <Text style={[styles.landCoverValue, styles.landCoverBoxValue]}>{row.value}</Text>
                                  </View>
                                ))}
                              </View>

                              {/* Equations below percentages (orange box) */}
                              <View style={styles.landCoverEquationBox}>
                                <Text style={styles.landCoverEquationText}>
                                  <Text style={{ fontWeight: '700' }}>Pricing equations:</Text>
                                  {equationText ? `\n${equationText}` : ' Not available'}
                                </Text>
                              </View>

                              {/* Sources at the very bottom */}
                              <View style={styles.landCoverNotes}>
                                <Text style={styles.landCoverNotesText}>
                                  <Text style={{ fontWeight: '600' }}>Sources: </Text>
                                  {msuTitle ? `${msuTitle}. ` : ''}
                                  {msuUrl ? `MSU: ${msuUrl}. ` : ''}
                                  {mdotUrl ? `MDOT: ${mdotUrl}. ` : ''}
                                  {eiaUrl ? `EIA: ${eiaUrl}.` : ''}
                                </Text>
                              </View>

                              {reportError?.message && (
                                <View style={styles.landCoverNotes}>
                                  <Text style={styles.landCoverNotesText}>
                                    <Text style={{ fontWeight: '600' }}>Note: </Text>
                                    {reportError.message}
                                  </Text>
                                </View>
                              )}
                            </>
                          )}
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
                            <Text style={styles.solarAvgScoreValue}>{(avgScore ?? 0).toFixed(1)}</Text>
                          </View>
                          
                          {/* Legend */}
                          <View style={styles.topoLegend}>
                            <View style={styles.topoLegendSingle}>
                              <Text style={styles.topoLegendTitle}>Solar Suitability Range</Text>
                              <View style={styles.topoLegendRow}>
                                <View style={styles.topoLegendEndColumn}>
                                  <Text style={styles.topoLegendEndLabel}>Lowest</Text>
                                  <Text style={styles.topoLegendValue}>{(minScore ?? 0).toFixed(0)}</Text>
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
                                  <Text style={styles.topoLegendValue}>{(maxScore ?? 0).toFixed(0)}</Text>
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
  dropdownButton: {
    backgroundColor: COLORS.inputBg,
    borderWidth: 2,
    borderColor: COLORS.borderLight,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dropdownButtonText: {
    fontSize: 16,
    color: COLORS.text,
  },
  dropdownArrow: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  dropdownList: {
    backgroundColor: COLORS.inputBg,
    borderWidth: 2,
    borderColor: COLORS.borderLight,
    borderRadius: 6,
    marginTop: 4,
    maxHeight: 200,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  dropdownInnerScroll: {
    maxHeight: 180,
  },
  dropdownSearchInput: {
    backgroundColor: COLORS.inputBg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: COLORS.text,
  },
  dropdownLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  dropdownButtonDisabled: {
    opacity: 0.6,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
  subLabel: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 6,
  },
  rotationSaveButton: {
    marginTop: 12,
    backgroundColor: COLORS.buttonBg,
    borderWidth: 1,
    borderColor: COLORS.buttonBorder,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  rotationSaveButtonText: {
    color: COLORS.buttonText,
    fontSize: 16,
    fontWeight: '600',
  },
    borderColor: COLORS.borderLight,
    borderRadius: 3,
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
  },
  checkmark: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.accent,
  },
  dropdownItemText: {
    fontSize: 16,
    color: COLORS.text,
  },
  dropdownEmptyText: {
    padding: 14,
    fontSize: 14,
    color: COLORS.textLight,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  checkboxGroup: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
  },
  checkboxOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  checkboxLabel: {
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
    textAlign: 'center',
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
    textAlign: 'center',
  },
  selectedFarmDetails: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  selectedFarmArea: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 4,
    textAlign: 'center',
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
  modalHeaderIconButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalHeaderIconText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
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
  landCoverPercentagesBox: {
    backgroundColor: '#2F5D9A',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 6,
    marginTop: 6,
  },
  landCoverEquationBox: {
    backgroundColor: '#B45309',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 6,
  },
  landCoverEquationText: {
    fontSize: 10,
    color: '#FFFFFF',
    textAlign: 'left',
  },
  landCoverBoxLabel: {
    color: '#FFFFFF',
  },
  landCoverBoxValue: {
    color: '#FFFFFF',
  },
  landCoverValueMultiline: {
    textAlign: 'right',
    lineHeight: 14,
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
    marginTop: 6,
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
