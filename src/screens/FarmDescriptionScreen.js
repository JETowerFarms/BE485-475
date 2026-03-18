  const arrayTypeOptions = [
    { value: '0', label: 'Fixed Open Rack' },
    { value: '1', label: 'Fixed Roof Mounted' },
    { value: '2', label: '1-Axis' },
    { value: '3', label: '1-Axis Backtracking' },
    { value: '4', label: '2-Axis' },
  ];

  const moduleTypeOptions = [
    { value: '0', label: 'Standard' },
    { value: '1', label: 'Premium' },
    { value: '2', label: 'Thin Film' },
  ];

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Pressable,
  Modal,
  Alert,
  Platform,
  Image,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Animated,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Polygon, Image as SvgImage, ClipPath, Defs, Rect, Pattern, Path, LinearGradient, Stop } from 'react-native-svg';
import Carousel from 'react-native-reanimated-carousel';
import { interpolate } from 'react-native-reanimated';
import { buildApiUrl, apiFetch } from '../config/apiConfig';

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
  // Back button (shared across all screens)
  backBtnBg: '#5A554E',
  backBtnBorder: '#3D3A36',
  // Complementary warm button
  nextButtonBg: '#F4A460',
  nextButtonBorder: '#E8946A',
  // Drawer colors
  drawerBg: '#FFFFFF',
  drawerHandle: '#D4D0C4',
};

const DRAWER_WIDTH = Dimensions.get('window').width * 0.75;
const MAX_GRID_POINTS = 25000;
// Feature flag: hide site-prep report in satellite modal without deleting logic
const SHOW_SITE_PREP_REPORT = false;

const toCoordKey = (coord) => {
  if (!coord) return 'na';
  const [lng, lat] = coord;
  if (typeof lng !== 'number' || typeof lat !== 'number') {
    return 'na';
  }
  return `${lng.toFixed(6)}_${lat.toFixed(6)}`;
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

const validateCoordinates = (coordinates) => {
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
};

const isLikelyLatLngMichigan = (coordinates) => {
  const hits = coordinates.filter((coord) => {
    const lat = coord[0];
    const lng = coord[1];
    return lat >= 40 && lat <= 50 && lng >= -90 && lng <= -80;
  });
  return hits.length >= Math.ceil(coordinates.length * 0.75);
};

const closePolygonRing = (coordinates) => {
  const ring = [...coordinates];
  if (ring.length > 0) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (!last || first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([...first]);
    }
  }
  return ring;
};

const swapCoordinatePairs = (coordinates) => coordinates.map((coord) => [coord[1], coord[0]]);

const reorderPolygon = (coordinates) => {
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
      lat: acc.lat + coord[1],
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
};

const toGridIndex = (value, origin, resolution) => Math.round((value - origin) / resolution);
const fromGridIndex = (index, origin, resolution) => origin + index * resolution;

const traceBoundaryGrid = (ring, resolution, bounds) => {
  const seen = new Set();
  const boundary = [];

  for (let i = 0; i + 1 < ring.length; i += 1) {
    const [lng0, lat0] = ring[i];
    const [lng1, lat1] = ring[i + 1];
    let x0 = toGridIndex(lng0, bounds.minLng, resolution);
    let y0 = toGridIndex(lat0, bounds.minLat, resolution);
    const x1 = toGridIndex(lng1, bounds.minLng, resolution);
    const y1 = toGridIndex(lat1, bounds.minLat, resolution);

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      const key = `${x0},${y0}`;
      if (!seen.has(key)) {
        seen.add(key);
        boundary.push([
          fromGridIndex(x0, bounds.minLng, resolution),
          fromGridIndex(y0, bounds.minLat, resolution),
        ]);
      }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  return boundary;
};

const fillGridByBoundingBox = (resolution, bounds) => {
  const maxX = Math.round((bounds.maxLng - bounds.minLng) / resolution);
  const maxY = Math.round((bounds.maxLat - bounds.minLat) / resolution);
  const points = [];

  for (let y = maxY; y >= 0; y -= 1) {
    for (let x = 0; x <= maxX; x += 1) {
      points.push([
        fromGridIndex(x, bounds.minLng, resolution),
        fromGridIndex(y, bounds.minLat, resolution),
      ]);
    }
  }

  return points;
};

const getPolygonTransform = (coordinates, size) => {
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('FAST FAIL: Invalid tile size for polygon transform');
  }

  if (!coordinates || coordinates.length < 3) {
    throw new Error('FAST FAIL: Invalid coordinates - must provide at least 3 points for a valid polygon');
  }

  let coords = [...coordinates];
  if (coords.length > 1) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) {
      coords = coords.slice(0, -1);
    }
  }

  if (coords.length < 3) {
    throw new Error('FAST FAIL: Invalid coordinates - polygon ring is degenerate');
  }

  let centroidX = 0;
  let centroidY = 0;
  coords.forEach(([lng, lat]) => {
    centroidX += lng;
    centroidY += lat;
  });
  centroidX /= coords.length;
  centroidY /= coords.length;

  const sortedCoords = [...coords].sort((a, b) => {
    const angleA = Math.atan2(a[1] - centroidY, a[0] - centroidX);
    const angleB = Math.atan2(b[1] - centroidY, b[0] - centroidX);
    return angleA - angleB;
  });

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
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const toPixel = (lng, lat) => ({
    x: padding + (lng - cx) * scale + availableSize / 2,
    y: padding + (cy - lat) * scale + availableSize / 2,
  });

  return {
    toPixel,
    scale,
  };
};

const buildGridPointsFromResolution = (coordinates, resolution) => {
  validateCoordinates(coordinates);

  if (!Number.isFinite(resolution) || resolution <= 0) {
    throw new Error('FAST FAIL: Invalid grid resolution - expected a positive number');
  }

  const normalizedCoordinates = isLikelyLatLngMichigan(coordinates)
    ? swapCoordinatePairs(coordinates)
    : coordinates;

  const ring = closePolygonRing(normalizedCoordinates);
  const bounds = getPolygonBounds(ring);
  let fillPoints = fillGridByBoundingBox(resolution, bounds);
  let boundaryGridPoints = traceBoundaryGrid(ring, resolution, bounds);

  if (fillPoints.length === 0) {
    const reorderedRing = reorderPolygon(coordinates);
    const reorderedBounds = getPolygonBounds(reorderedRing);
    const reorderedFill = fillGridByBoundingBox(resolution, reorderedBounds);
    const reorderedBoundary = traceBoundaryGrid(reorderedRing, resolution, reorderedBounds);
    if (reorderedFill.length > 0) {
      return { ring: reorderedRing, gridPoints: reorderedFill, boundaryGridPoints: reorderedBoundary, fillPoints: reorderedFill };
    }

    const swapped = swapCoordinatePairs(coordinates);
    const swappedRing = closePolygonRing(swapped);
    const swappedBounds = getPolygonBounds(swappedRing);
    const swappedFill = fillGridByBoundingBox(resolution, swappedBounds);
    const swappedBoundary = traceBoundaryGrid(swappedRing, resolution, swappedBounds);
    if (swappedFill.length > 0) {
      return { ring: swappedRing, gridPoints: swappedFill, boundaryGridPoints: swappedBoundary, fillPoints: swappedFill };
    }

    const swappedReorderedRing = reorderPolygon(swapped);
    const swappedReorderedBounds = getPolygonBounds(swappedReorderedRing);
    const swappedReorderedFill = fillGridByBoundingBox(resolution, swappedReorderedBounds);
    const swappedReorderedBoundary = traceBoundaryGrid(swappedReorderedRing, resolution, swappedReorderedBounds);
    if (swappedReorderedFill.length > 0) {
      return { ring: swappedReorderedRing, gridPoints: swappedReorderedFill, boundaryGridPoints: swappedReorderedBoundary, fillPoints: swappedReorderedFill };
    }
  }

  if (fillPoints.length === 0) {
    throw new Error('FAST FAIL: No grid points generated - invalid or degenerate farm boundary');
  }

  if (fillPoints.length > MAX_GRID_POINTS) {
    throw new Error(`FAST FAIL: Too many grid points (${fillPoints.length}) - farm boundary too large for analysis`);
  }

  return { ring, gridPoints: fillPoints, boundaryGridPoints, fillPoints };
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
  // Get bounds using the original winding to preserve concave shapes
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  coords.forEach(([lng, lat]) => {
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
  
  // Preserve input vertex order so concave polygons render correctly
  return coords.map(([lng, lat]) => {
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

const computeCentroidLatLng = (coordinates) => {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return { lat: 0, lon: 0 };
  let sumLat = 0;
  let sumLon = 0;
  coordinates.forEach(([lng, lat]) => {
    sumLat += lat;
    sumLon += lng;
  });
  return { lat: sumLat / coordinates.length, lon: sumLon / coordinates.length };
};

// Farm polygon colors
const FARM_COLORS = [
  '#7CB342', // Light green
  '#43A047', // Green
  '#2E7D32', // Dark green
  '#558B2F', // Lime green
  '#33691E', // Deep green
];







// NOTE: Deleted getElevationColor function - no longer using fake elevation data
// NOTE: Deleted getSolarColor function - all farms now use backend-calculated colors









// NOTE: Deleted fake getDetailedSolarScore and getElevationForCoord functions.
// They calculated slope from fake elevation data (only 63 points interpolated across Michigan).
// The real solar suitability data already includes actual slope values from LandFire 2020.
// Solar scores use 100% REAL data: land cover (NLCD 2024), slope (LandFire 2020), 
// transmission lines (EIA 123,473 points), and population (GPW 2020).
// Topological view now uses REAL slope data instead of synthetic sine/cosine waves.

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

// NOTE: generateElevationHeatMap removed - all farms now use backend-generated heat maps
// NOTE: generateSolarHeatMap removed - all farms now use backend-generated heat maps

// View types for the horizontal carousel - different views of a particular farm
const VIEW_TYPES = [
  {
    id: 'satellite',
    name: 'Satellite',
    description: '',
    icon: '🛰️',
    color: '#4169E1', // Royal blue for satellite
  },
  {
    id: 'solar',
    name: 'Solar Suitability',
    description: '',
    icon: '☀️',
    color: '#FFD700', // Gold for solar
  },
  {
    id: 'elevation',
    name: 'Elevation',
    description: '',
    icon: '🏔️',
    color: '#8B4513', // Brown for elevation
  },
];

const FarmDescriptionScreen = ({ farms, county, city, onNavigateBack, onNavigateNext, onFarmsUpdate, onOpenModelEditor }) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerAnim = useRef(new Animated.Value(0)).current;
  const carouselRef = useRef(null);
  const [currentIndex, setCurrentIndex] = useState(0);


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

  useEffect(() => {
    console.log('[FarmDescription] expandedModalVisible', expandedModalVisible);
  }, [expandedModalVisible]);

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
  const emptyCropForm = {
    id: null,
    name: '',
    category: '',
    unit: '',
    yield_per_acre: '',
    price_per_unit_0: '',
    cost_per_acre: '',
    escalation_rate: '',
  };
  const [cropEditorVisible, setCropEditorVisible] = useState(false);
  const [cropEditorMode, setCropEditorMode] = useState('create');
  const [cropForm, setCropForm] = useState(emptyCropForm);
  const [cropEditorError, setCropEditorError] = useState('');
  const [cropEditorSaving, setCropEditorSaving] = useState(false);
  const CONFIG_STORAGE_KEY = '@farm_form_configs';
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [configName, setConfigName] = useState('');
  const [savedConfigs, setSavedConfigs] = useState([]);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState('');
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);

  // Incentive picker state
  const [incentiveCatalog, setIncentiveCatalog] = useState([]);
  const [incentivesLoading, setIncentivesLoading] = useState(false);
  const [selectedIncentiveIds, setSelectedIncentiveIds] = useState([]);
  const [incentiveDropdownOpen, setIncentiveDropdownOpen] = useState(false);
  const [incentivesError, setIncentivesError] = useState(null);
  const [incentiveParams, setIncentiveParams] = useState({ brownfield_egle_amount: 500000 });

  // Other form fields (restored)
  const [farmType, setFarmType] = useState('');
  const [acreage, setAcreage] = useState('');
  const [primaryCrops, setPrimaryCrops] = useState('');
  const [soilType, setSoilType] = useState('');
  const [irrigationType, setIrrigationType] = useState('');
  const [notes, setNotes] = useState('');

  // PVWatts / optimization inputs per-farm — Michigan-appropriate defaults
  // Tilt 35°: optimal for ~42°N latitude (MI); Azimuth 180°: due south;
  // Losses 16%: NREL base 14% + ~2% Michigan snow/soiling; kW/acre 200: agrivoltaic row spacing standard
  const emptyPvInputs = { kwPerAcre: '200', tilt: '35', azimuth: '180', arrayType: '0', moduleType: '0', losses: '16' };
  const [pvInputsByFarmId, setPvInputsByFarmId] = useState({});
  const [pvDraftByFarmId, setPvDraftByFarmId] = useState({});
  const [pvFarmId, setPvFarmId] = useState(null);
  const [pvFarmDropdownOpen, setPvFarmDropdownOpen] = useState(false);
  const [arrayTypeDropdownOpen, setArrayTypeDropdownOpen] = useState(false);
  const [moduleTypeDropdownOpen, setModuleTypeDropdownOpen] = useState(false);

  const [submitError, setSubmitError] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);

  const isFormValid = selectedFarmIds.length > 0 && siteIncludes === 'farming';

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

  // Keep rotationFarmId and pvFarmId pointed at selected farms
  useEffect(() => {
    if (selectedFarmIds.length === 0) {
      setRotationFarmId(null);
      setPvFarmId(null);
      return;
    }

    if (!rotationFarmId || !selectedFarmIds.includes(rotationFarmId)) {
      setRotationFarmId(selectedFarmIds[0]);
    }

    if (!pvFarmId || !selectedFarmIds.includes(pvFarmId)) {
      setPvFarmId(selectedFarmIds[0]);
    }
  }, [selectedFarmIds, rotationFarmId, pvFarmId]);

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

  // Seed PV draft state from saved state when changing selected PV farm
  useEffect(() => {
    if (!pvFarmId) return;
    setPvDraftByFarmId((prev) => {
      if (prev[pvFarmId]) return prev;
      const saved = pvInputsByFarmId?.[pvFarmId];
      return {
        ...prev,
        [pvFarmId]: { ...(saved || emptyPvInputs) },
      };
    });
  }, [pvFarmId, pvInputsByFarmId]);

  // Load crop options (for searchable dropdown)
  useEffect(() => {
    let cancelled = false;

    const loadCrops = async () => {
      setCropOptionsLoading(true);
      setCropOptionsError('');
      try {
        const response = await apiFetch(buildApiUrl('/crops'));
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

  const pvDraft = pvFarmId ? pvDraftByFarmId?.[pvFarmId] : null;
  const pvDraftInputs = pvDraft || emptyPvInputs;

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

  const setPvDraftField = (field, value) => {
    if (!pvFarmId) return;
    setPvDraftByFarmId((prev) => ({
      ...prev,
      [pvFarmId]: { ...(prev[pvFarmId] || emptyPvInputs), [field]: value },
    }));
  };

  const savePvForCurrentFarm = useCallback(() => {
    if (!pvFarmId) return;
    setPvInputsByFarmId((prev) => ({
      ...prev,
      [pvFarmId]: { ...(pvDraftByFarmId?.[pvFarmId] || emptyPvInputs) },
    }));
  }, [pvFarmId, pvDraftByFarmId, emptyPvInputs]);

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

  const resetCropForm = () => {
    setCropForm({ ...emptyCropForm });
    setCropEditorMode('create');
    setCropEditorError('');
  };

  const startNewCrop = () => {
    resetCropForm();
    setCropEditorVisible(true);
  };

  const startEditCrop = (crop) => {
    if (!crop) return;
    setCropEditorMode('edit');
    setCropForm({
      id: crop.id ?? null,
      name: crop.name || crop.crop || '',
      category: crop.category || '',
      unit: crop.unit || '',
      yield_per_acre: crop.yield_per_acre !== null && crop.yield_per_acre !== undefined ? String(crop.yield_per_acre) : '',
      price_per_unit_0: crop.price_per_unit_0 !== null && crop.price_per_unit_0 !== undefined ? String(crop.price_per_unit_0) : '',
      cost_per_acre: crop.cost_per_acre !== null && crop.cost_per_acre !== undefined ? String(crop.cost_per_acre) : '',
      escalation_rate: crop.escalation_rate !== null && crop.escalation_rate !== undefined ? String(crop.escalation_rate) : '',
    });
    setCropEditorError('');
    setCropEditorVisible(true);
  };

  const closeCropEditor = () => {
    setCropEditorVisible(false);
    resetCropForm();
  };

  const applyCropUpdate = (updatedCrop) => {
    setCropOptions((prev) => {
      const filtered = prev.filter((c) => c?.id !== updatedCrop?.id);
      const next = [...filtered, updatedCrop];
      next.sort((a, b) => String(a?.name || a?.crop || '').localeCompare(String(b?.name || b?.crop || '')));
      return next;
    });
  };

  const removeCropFromRotations = useCallback((cropId) => {
    setRotationDraftByFarmId((prev) => {
      const next = {};
      Object.entries(prev || {}).forEach(([farmId, data]) => {
        const ids = Array.isArray(data?.cropIds) ? data.cropIds.filter((id) => id !== cropId) : [];
        next[farmId] = { cropIds: ids };
      });
      return next;
    });

    setRotationByFarmId((prev) => {
      const next = {};
      Object.entries(prev || {}).forEach(([farmId, data]) => {
        const ids = Array.isArray(data?.cropIds) ? data.cropIds.filter((id) => id !== cropId) : [];
        next[farmId] = { cropIds: ids };
      });
      return next;
    });
  }, []);

  const buildCropPayloadFromForm = () => {
    const errs = [];
    const name = cropForm.name.trim();
    const unit = cropForm.unit.trim();
    if (!name) errs.push('Name is required');
    if (!unit) errs.push('Unit is required');

    const parseNumberField = (value, label, { allowEmpty = false } = {}) => {
      if (value === '' || value === null || value === undefined) {
        if (allowEmpty) return null;
        errs.push(`${label} is required`);
        return null;
      }
      const num = Number(value);
      if (!Number.isFinite(num)) {
        errs.push(`${label} must be a number`);
        return null;
      }
      return num;
    };

    const payload = {
      name,
      crop: name,
      category: cropForm.category.trim() || null,
      unit,
      yield_per_acre: parseNumberField(cropForm.yield_per_acre, 'yield_per_acre'),
      price_per_unit_0: parseNumberField(cropForm.price_per_unit_0, 'price_per_unit_0'),
      cost_per_acre: parseNumberField(cropForm.cost_per_acre, 'cost_per_acre'),
      escalation_rate: parseNumberField(cropForm.escalation_rate, 'escalation_rate', { allowEmpty: true }) ?? 0,
    };

    return { errs, payload };
  };

  const saveCropFromForm = async () => {
    setCropEditorError('');
    const { errs, payload } = buildCropPayloadFromForm();
    if (errs.length) {
      setCropEditorError(errs.join('; '));
      return;
    }

    const isEdit = cropEditorMode === 'edit' && cropForm.id;
    setCropEditorSaving(true);
    try {
      const response = await apiFetch(
        buildApiUrl(isEdit ? `/crops/${cropForm.id}` : '/crops'),
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      const data = await response.json();
      if (!response.ok) {
        const detail = data?.details?.join('; ') || data?.message || response.statusText;
        throw new Error(detail || 'Failed to save crop');
      }

      applyCropUpdate(data);
      setCropEditorVisible(false);
      resetCropForm();
    } catch (err) {
      setCropEditorError(err?.message || 'Failed to save crop');
    } finally {
      setCropEditorSaving(false);
    }
  };

  const deleteCropById = async (cropId) => {
    setCropEditorError('');
    setCropEditorSaving(true);
    try {
      const response = await apiFetch(buildApiUrl(`/crops/${cropId}`), { method: 'DELETE' });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to delete crop');
      }

      setCropOptions((prev) => prev.filter((c) => c?.id !== cropId));
      removeCropFromRotations(cropId);
        if (cropForm.id === cropId) {
          resetCropForm();
        }
    } catch (err) {
      setCropEditorError(err?.message || 'Failed to delete crop');
    } finally {
      setCropEditorSaving(false);
    }
  };

  const confirmDeleteCrop = (crop) => {
    if (!crop?.id) return;
    Alert.alert(
      'Delete crop',
      `Are you sure you want to delete "${crop.name || crop.crop}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteCropById(crop.id) },
      ],
    );
  };

  const formatNumber = (value) => {
    if (value === null || value === undefined || value === '') return '—';
    const num = Number(value);
    return Number.isFinite(num) ? num.toLocaleString(undefined, { maximumFractionDigits: 4 }) : String(value);
  };

  const loadSavedConfigs = useCallback(async () => {
    setConfigLoading(true);
    setConfigError('');
    try {
      const raw = await AsyncStorage.getItem(CONFIG_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      setSavedConfigs(Array.isArray(parsed) ? parsed : []);
    } catch (err) {
      setConfigError(err?.message || 'Failed to load saved configurations');
    } finally {
      setConfigLoading(false);
    }
  }, [CONFIG_STORAGE_KEY]);

  useEffect(() => {
    loadSavedConfigs();
  }, [loadSavedConfigs]);

  const fetchModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError('');
    try {
      const resp = await apiFetch(buildApiUrl('/models'));
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `Failed to load models (${resp.status})`);
      }
      const data = await resp.json();
      const list = Array.isArray(data?.models) ? data.models : [];
      setModels(list);
    } catch (err) {
      setModelsError(err?.message || 'Failed to load models');
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Fetch incentive catalog from backend
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIncentivesLoading(true);
      try {
        const resp = await apiFetch(buildApiUrl('/linear-optimization/incentives'));
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!cancelled && Array.isArray(data?.incentives)) {
          setIncentiveCatalog(data.incentives);
          // Select all by default
          setSelectedIncentiveIds(data.incentives.map(i => i.id));
        }
      } catch (err) {
        if (!cancelled) setIncentivesError(err?.message || 'Could not load incentives');
      } finally {
        if (!cancelled) setIncentivesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleIncentive = (id) => {
    setSelectedIncentiveIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Keep selected model aligned with fetched list without overwriting user choice.
  useEffect(() => {
    if (!models || models.length === 0) {
      setSelectedModel(null);
      setSelectedModelId(null);
      return;
    }

    // If user already picked a model and it still exists, keep it.
    if (selectedModelId) {
      const preferred = models.find((m) => m.id === selectedModelId);
      if (preferred) {
        if (selectedModel?.id !== preferred.id) {
          setSelectedModel(preferred);
        }
        return;
      }
      // If the chosen model disappeared from the list, leave the current selection untouched.
      return;
    }

    // No prior selection: pick Default if present, else first model.
    const fallback = models.find((m) => m.name === 'Default') || models[0] || null;
    setSelectedModel(fallback);
    setSelectedModelId(fallback ? fallback.id : null);
  }, [models, selectedModelId, selectedModel]);

  const buildConfigSnapshot = () => ({
    selectedFarmIds,
    siteIncludes,
    rotationByFarmId,
    rotationDraftByFarmId,
    pvInputsByFarmId,
    pvDraftByFarmId,
    pvFarmId,
    selectedModelId,
    farmType,
    acreage,
    primaryCrops,
    soilType,
    irrigationType,
    notes,
  });

  const applyConfigSnapshot = (snap) => {
    setSelectedFarmIds(Array.isArray(snap?.selectedFarmIds) ? snap.selectedFarmIds : []);
    setSiteIncludes(snap?.siteIncludes || '');
    setRotationByFarmId(snap?.rotationByFarmId || {});
    setRotationDraftByFarmId(snap?.rotationDraftByFarmId || {});
    setPvInputsByFarmId(snap?.pvInputsByFarmId || {});
    setPvDraftByFarmId(snap?.pvDraftByFarmId || {});
    setPvFarmId(snap?.pvFarmId || (Array.isArray(snap?.selectedFarmIds) ? snap.selectedFarmIds[0] : null));
    setSelectedModelId(snap?.selectedModelId || null);
    setFarmType(snap?.farmType || '');
    setAcreage(snap?.acreage || '');
    setPrimaryCrops(snap?.primaryCrops || '');
    setSoilType(snap?.soilType || '');
    setIrrigationType(snap?.irrigationType || '');
    setNotes(snap?.notes || '');
  };

  const saveCurrentConfig = async () => {
    const name = configName.trim();
    if (!name) {
      setConfigError('Name is required to save configuration');
      return;
    }
    const entry = {
      id: Date.now(),
      name,
      savedAt: new Date().toISOString(),
      snapshot: buildConfigSnapshot(),
    };

    try {
      const existing = savedConfigs.filter((c) => c.name !== name);
      const next = [entry, ...existing];
      await AsyncStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next));
      setSavedConfigs(next);
      setConfigName('');
      setConfigError('');
    } catch (err) {
      setConfigError(err?.message || 'Failed to save configuration');
    }
  };

  const loadConfig = async (config) => {
    if (!config?.snapshot) return;
    applyConfigSnapshot(config.snapshot);
    setConfigModalVisible(false);
  };

  const deleteConfig = async (configId) => {
    try {
      const next = savedConfigs.filter((c) => c.id !== configId);
      await AsyncStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next));
      setSavedConfigs(next);
    } catch (err) {
      setConfigError(err?.message || 'Failed to delete configuration');
    }
  };

  const confirmDeleteConfig = (config) => {
    Alert.alert(
      'Delete saved configuration',
      `Delete "${config?.name || 'Untitled'}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteConfig(config.id) },
      ],
    );
  };

  // Get or compute cached view data for a farm
  const getViewData = useCallback((farmId, coords, tileSize, viewTypeId, options = {}) => {
    const bounds = getPolygonBounds(coords);
    const polygonPoints = normalizePolygon(coords, tileSize);
    const gridResolution = options.gridResolution ?? options.farm?.backendAnalysis?.metadata?.grid?.resolution;

    let viewData;

    if (viewTypeId === 'satellite') {
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
      
      viewData = {
        bounds,
        polygonPoints,
        tiles,
      };
    } else if (viewTypeId === 'solar' || viewTypeId === 'elevation') {
      if (!Number.isFinite(gridResolution)) {
        throw new Error(`FAST FAIL: Missing grid resolution for farm ${farmId || 'unknown'}`);
      }

      const { ring, gridPoints, boundaryGridPoints, fillPoints } = buildGridPointsFromResolution(coords, gridResolution);
      const backendBoundaryPoints = options.farm?.backendAnalysis?.metadata?.grid?.boundaryPoints;
      const boundaryPoints = Array.isArray(backendBoundaryPoints) && backendBoundaryPoints.length > 0
        ? backendBoundaryPoints
        : boundaryGridPoints;
      const boundaryKeySet = new Set(
        boundaryPoints
          .filter((point) => Array.isArray(point) && point.length === 2)
          .map((point) => `${Number(point[0]).toFixed(6)},${Number(point[1]).toFixed(6)}`)
      );

      const backendGridPoints = Array.isArray(options.farm?.backendAnalysis?.metadata?.grid?.gridPoints)
        ? options.farm?.backendAnalysis?.metadata?.grid?.gridPoints
        : null;

      const resultsKey = viewTypeId === 'solar'
        ? 'solarSuitability'
        : 'elevation';
      const resultList = options.farm?.backendAnalysis?.[resultsKey]?.results;
      const colorMap = new Map(
        Array.isArray(resultList)
          ? resultList
              .map((result) => {
                const coords = result?.coordinates;
                if (!Array.isArray(coords) || coords.length !== 2) return null;
                const color = result?.heatmap_color;
                if (typeof color !== 'string' || color.trim() === '') return null;
                return [`${Number(coords[0]).toFixed(6)},${Number(coords[1]).toFixed(6)}`, color];
              })
              .filter(Boolean)
          : []
      );

      const solidPoints = backendGridPoints && backendGridPoints.length > 0 ? backendGridPoints : gridPoints;
      const solidSet = new Set(
        solidPoints
          .filter((point) => Array.isArray(point) && point.length === 2)
          .map((point) => `${Number(point[0]).toFixed(6)},${Number(point[1]).toFixed(6)}`)
      );

      const guessedPoints = fillPoints.filter((point) => {
        if (!Array.isArray(point) || point.length !== 2) return false;
        const key = `${Number(point[0]).toFixed(6)},${Number(point[1]).toFixed(6)}`;
        return !solidSet.has(key) && !boundaryKeySet.has(key);
      });

      const combinedPoints = (() => {
        const seen = new Set();
        const merged = [];
        for (const point of [...solidPoints, ...boundaryPoints]) {
          if (!Array.isArray(point) || point.length !== 2) continue;
          const key = `${Number(point[0]).toFixed(6)},${Number(point[1]).toFixed(6)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(point);
        }
        return merged;
      })();
      const transform = getPolygonTransform(ring, tileSize);
      const cellWidth = gridResolution * transform.scale;
      const cellHeight = gridResolution * transform.scale;

      const gridCells = [...combinedPoints, ...guessedPoints].map((point, index) => {
        const { x, y } = transform.toPixel(point[0], point[1]);
        const key = `${Number(point[0]).toFixed(6)},${Number(point[1]).toFixed(6)}`;
        return {
          key: `${farmId || 'farm'}-${viewTypeId}-${index}`,
          x: x - cellWidth / 2,
          y: y - cellHeight / 2,
          width: cellWidth,
          height: cellHeight,
          isGuess: index >= combinedPoints.length,
          isBoundary: boundaryKeySet.has(key),
          fillColor: colorMap.get(key) || null,
        };
      });

      viewData = {
        bounds: getPolygonBounds(ring),
        polygonPoints: normalizePolygon(ring, tileSize),
        gridCells,
        gridResolution,
      };
    } else {
      return null;
    }
    
    return viewData;
  }, []);

  // Get or create cached tile render for a specific farm and view type
  const getCachedTileRender = useCallback((farmId, coords, viewTypeId, tileSize, renderFn, options = {}) => {
    return renderFn();
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
    console.log('[FarmDescription] Tile press', {
      viewTypeId: viewType?.id,
      farmIndex,
    });
    setModalLoading(true);
    setExpandedViewType(viewType);
    setExpandedFarmIndex(farmIndex);
    setExpandedModalVisible(true);
    
    // Clear loading after a brief delay to allow modal to render
    setTimeout(() => {
      console.log('[FarmDescription] Modal open', {
        viewTypeId: viewType?.id,
        farmIndex,
      });
      setModalLoading(false);
    }, 100);
  };

  const updateFarmById = useCallback((farmId, updater) => {
    if (!onFarmsUpdate || !farmId) return;
    const nextFarms = (farms || []).map((farm) => {
      if (farm?.id !== farmId) return farm;
      return updater(farm);
    });
    onFarmsUpdate(nextFarms);
  }, [farms, onFarmsUpdate]);

  const refreshFarmAnalysis = useCallback(async (farm) => {
    const farmId = farm?.id;
    if (!farmId) return;

    const rawCoordinates = farm?.geometry?.coordinates?.[0] || [];
    const coordinates = rawCoordinates.length > 1 &&
      rawCoordinates[0][0] === rawCoordinates[rawCoordinates.length - 1][0] &&
      rawCoordinates[0][1] === rawCoordinates[rawCoordinates.length - 1][1]
      ? rawCoordinates.slice(0, -1)
      : rawCoordinates;

    validateCoordinates(coordinates);

    setModalLoading(true);
    updateFarmById(farmId, (current) => ({
      ...current,
      analysisStatus: 'running',
    }));

    try {
      const response = await apiFetch(buildApiUrl('/reports/analyze'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coordinates, userId: 'default-user' }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend API error (${response.status}): ${errorText}`);
      }

      const responseText = await response.text();
      let backendAnalysis;
      try {
        backendAnalysis = JSON.parse(responseText);
      } catch (parseError) {
        throw new Error(`Invalid JSON response: ${parseError.message}`);
      }

      updateFarmById(farmId, (current) => ({
        ...current,
        properties: {
          ...current.properties,
          avgSuitability: backendAnalysis?.solarSuitability?.summary?.averageSuitability,
        },
        backendAnalysis,
        analysisStatus: 'completed',
      }));
    } catch (error) {
      console.warn('Refresh analysis failed:', error?.message || error);
      updateFarmById(farmId, (current) => ({
        ...current,
        analysisStatus: 'error',
      }));
    } finally {
      setModalLoading(false);
    }
  }, [updateFarmById]);

  const handleNext = async () => {
    setSubmitError('');
    const effectiveRotationsByFarmId = { ...rotationByFarmId };
    selectedFarmIds.forEach((farmId) => {
      const draft = rotationDraftByFarmId?.[farmId];
      if (!draft) return;
      const cropIds = Array.isArray(draft.cropIds) ? draft.cropIds : [];
      effectiveRotationsByFarmId[farmId] = { cropIds };
    });

    const effectivePvByFarmId = { ...pvInputsByFarmId };
    selectedFarmIds.forEach((farmId) => {
      const draft = pvDraftByFarmId?.[farmId];
      if (!draft) return;
      effectivePvByFarmId[farmId] = { ...draft };
    });

    if (!selectedFarmIds.length) {
      setSubmitError('Select at least one farm.');
      return;
    }

    if (siteIncludes !== 'farming') {
      setSubmitError('Select "Farming" to provide PV system inputs.');
      return;
    }

    const selectedFarms = builtFarms.filter((f) => selectedFarmIds.includes(f.id));
    if (!selectedFarms.length) {
      setSubmitError('Selected farms are missing.');
      return;
    }

    const cropIdToName = new Map(
      (cropOptions || []).map((c) => [c?.id ?? c?.crop_id ?? c?.name ?? c?.crop, c?.name || c?.crop || ''])
    );

    setSubmitLoading(true);
    let updatedFarms = [...(farms || [])];

    try {
      for (const farm of selectedFarms) {
        const rawCoordinates = farm?.geometry?.coordinates?.[0] || [];
        const coordinates = rawCoordinates.length > 1 &&
          rawCoordinates[0][0] === rawCoordinates[rawCoordinates.length - 1][0] &&
          rawCoordinates[0][1] === rawCoordinates[rawCoordinates.length - 1][1]
          ? rawCoordinates.slice(0, -1)
          : rawCoordinates;

        validateCoordinates(coordinates);

        const area = calculatePolygonArea(coordinates).acres;
        const centroid = computeCentroidLatLng(coordinates);
        if (!area || area <= 0) {
          throw new Error(`Unable to compute area for ${getFarmLabel(farm.id)}.`);
        }

        const pv = effectivePvByFarmId[farm.id];
        if (!pv) {
          throw new Error(`Enter PV inputs for ${getFarmLabel(farm.id)}.`);
        }

        const parsedKwPerAcre = Number(pv.kwPerAcre);
        const parsedTilt = Number(pv.tilt);
        const parsedAzimuth = Number(pv.azimuth);
        const parsedArrayType = Number(pv.arrayType);
        const parsedModuleType = Number(pv.moduleType);
        const parsedLosses = Number(pv.losses);

        if (!Number.isFinite(parsedKwPerAcre) || !Number.isFinite(parsedTilt) || !Number.isFinite(parsedAzimuth) ||
            !Number.isFinite(parsedArrayType) || !Number.isFinite(parsedModuleType) || !Number.isFinite(parsedLosses)) {
          throw new Error(`All PV parameters must be numbers for ${getFarmLabel(farm.id)}.`);
        }

        const cropIds = Array.isArray(effectiveRotationsByFarmId?.[farm.id]?.cropIds)
          ? effectiveRotationsByFarmId[farm.id].cropIds
          : [];

        const cropNames = cropIds
          .map((id) => cropIdToName.get(id) || '')
          .filter((name) => name.trim().length > 0);

        if (cropNames.length === 0) {
          throw new Error(`Select at least one crop for ${getFarmLabel(farm.id)}.`);
        }

        const systemCapacity = area * parsedKwPerAcre; // kW per acre × acres = kW
        if (!Number.isFinite(systemCapacity) || systemCapacity <= 0) {
          throw new Error(`System capacity must be positive for ${getFarmLabel(farm.id)}.`);
        }

        const payload = {
          farmId: farm.id,
          geometry: farm.geometry,
          acres: area,
          crops: cropNames,
          pvwatts: {
            lat: centroid.lat,
            lon: centroid.lon,
            system_capacity: systemCapacity,
            module_type: parsedModuleType,
            array_type: parsedArrayType,
            tilt: parsedTilt,
            azimuth: parsedAzimuth,
            losses: parsedLosses,
          },
          modelId: selectedModel?.id || null,
          modelFlags: {
            ...(selectedIncentiveIds.length > 0 ? { eligible_incentives: selectedIncentiveIds } : {}),
            ...(selectedIncentiveIds.includes('brownfield_egle') ? { incentive_params: { brownfield_egle_amount: incentiveParams.brownfield_egle_amount } } : {}),
          },
        };

        const response = await apiFetch(buildApiUrl('/linear-optimization'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const text = await response.text();
        if (!response.ok) {
          throw new Error(text || `Request failed (${response.status}) for ${getFarmLabel(farm.id)}`);
        }
        const data = JSON.parse(text || '{}');

        updatedFarms = updatedFarms.map((f) => {
          if (f?.id !== payload.farmId) return f;
          return {
            ...f,
            linearOptimization: data.optimization || null,
            linearOptimizationLogs: data.logs || null,
          };
        });
      }

      if (onFarmsUpdate) {
        onFarmsUpdate(updatedFarms);
      }
      if (onNavigateNext) {
        onNavigateNext(updatedFarms);
      }
    } catch (err) {
      setSubmitError(err?.message || 'Failed to run optimization');
    } finally {
      setSubmitLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.headerBg} />
      
      {/* Back Button */}
      <Pressable
        style={({ pressed }) => [
          styles.backButton,
          pressed && styles.backButtonPressed,
        ]}
        onPress={onNavigateBack}
      >
        <Text style={styles.backButtonText}>←</Text>
      </Pressable>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Define Your Solar Site</Text>
      </View>

      <KeyboardAvoidingView 
        style={styles.formContainer}
        behavior="padding"
      >
        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
          persistentScrollbar={true}
        >
          <Pressable
            style={styles.rotationSaveButton}
            onPress={() => {
              setModelPickerVisible(true);
              fetchModels();
            }}
          >
            <Text style={styles.rotationSaveButtonText}>
              {`Choose model: ${selectedModel?.name || 'Default'}`}
            </Text>
          </Pressable>
          {modelsError ? <Text style={styles.errorText}>{modelsError}</Text> : null}

          <Pressable
            style={styles.rotationSaveButton}
            onPress={onOpenModelEditor}
          >
            <Text style={styles.rotationSaveButtonText}>Open model editor</Text>
          </Pressable>

          <Pressable
            style={styles.rotationSaveButton}
            onPress={() => {
              setConfigModalVisible(true);
              setConfigError('');
              loadSavedConfigs();
            }}
          >
            <Text style={styles.rotationSaveButtonText}>Save / Load configuration</Text>
          </Pressable>

          {/* Select Farms */}
          <View style={[styles.selectorCard, { marginTop: 16 }]}>
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
              <Text style={styles.dropdownArrow}>{farmDropdownOpen ? '^' : 'v'}</Text>
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

                <View style={styles.selectorCard}>
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
                  <Text style={styles.dropdownArrow}>{rotationFarmDropdownOpen ? '^' : 'v'}</Text>
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
                </View>

                <View style={styles.selectorCard}>
                <Text style={styles.subLabel}>Rotation crops (optional)</Text>
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
                  <Text style={styles.dropdownArrow}>{rotationDropdownOpen ? '^' : 'v'}</Text>
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
                </View>

                <Pressable
                  style={styles.rotationSaveButton}
                  onPress={startNewCrop}
                >
                  <Text style={styles.rotationSaveButtonText}>Edit crop table</Text>
                </Pressable>
              </View>
            </>
          )}

          {(siteIncludes === 'grazing' || siteIncludes === 'neither') && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>future direction</Text>
            </View>
          )}

          {siteIncludes === 'farming' && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>PV System Inputs (per farm)</Text>

              <View style={styles.selectorCard}>
              <Text style={styles.subLabel}>Choose farm</Text>
              <Pressable
                style={[styles.dropdownButton, selectedFarmIds.length === 0 && styles.dropdownButtonDisabled]}
                onPress={() => {
                  if (selectedFarmIds.length === 0) return;
                  setPvFarmDropdownOpen(!pvFarmDropdownOpen);
                }}
              >
                <Text style={styles.dropdownButtonText}>
                  {pvFarmId ? getFarmLabel(pvFarmId) : 'Select a farm...'}
                </Text>
                <Text style={styles.dropdownArrow}>{pvFarmDropdownOpen ? '^' : 'v'}</Text>
              </Pressable>

              {pvFarmDropdownOpen && (
                <ScrollView style={styles.dropdownList} nestedScrollEnabled={true}>
                  {selectedFarmIds.map((farmId) => (
                    <Pressable
                      key={farmId}
                      style={styles.dropdownItem}
                      onPress={() => {
                        setPvFarmId(farmId);
                        setPvFarmDropdownOpen(false);
                        setArrayTypeDropdownOpen(false);
                        setModuleTypeDropdownOpen(false);
                      }}
                    >
                      <View style={styles.checkbox}>
                        {pvFarmId === farmId && <Text style={styles.checkmark}>✓</Text>}
                      </View>
                      <Text style={styles.dropdownItemText}>{getFarmLabel(farmId)}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
              </View>

              <Text style={styles.subLabel}>kW per acre</Text>
              <TextInput
                style={styles.input}
                value={pvDraftInputs.kwPerAcre}
                onChangeText={(text) => setPvDraftField('kwPerAcre', text)}
                placeholder="e.g., 200 (agrivoltaic)"
                placeholderTextColor={COLORS.placeholder}
                keyboardType="numeric"
              />

              <Text style={styles.subLabel}>Tilt (degrees)</Text>
              <TextInput
                style={styles.input}
                value={pvDraftInputs.tilt}
                onChangeText={(text) => setPvDraftField('tilt', text)}
                placeholder="e.g., 35 (optimal for Michigan ~42°N)"
                placeholderTextColor={COLORS.placeholder}
                keyboardType="numeric"
              />

              <Text style={styles.subLabel}>Azimuth (degrees)</Text>
              <TextInput
                style={styles.input}
                value={pvDraftInputs.azimuth}
                onChangeText={(text) => setPvDraftField('azimuth', text)}
                placeholder="e.g., 180 (due south)"
                placeholderTextColor={COLORS.placeholder}
                keyboardType="numeric"
              />

              <View style={[styles.selectorCard, { marginTop: 16 }]}>
              <Text style={styles.subLabel}>Array Type</Text>
              <Pressable
                style={[styles.dropdownButton, !pvFarmId && styles.dropdownButtonDisabled]}
                onPress={() => {
                  if (!pvFarmId) return;
                  setArrayTypeDropdownOpen(!arrayTypeDropdownOpen);
                }}
              >
                <Text style={styles.dropdownButtonText}>
                  {pvDraftInputs.arrayType
                    ? arrayTypeOptions.find((o) => o.value === pvDraftInputs.arrayType)?.label || pvDraftInputs.arrayType
                    : 'Select array type'}
                </Text>
                <Text style={styles.dropdownArrow}>{arrayTypeDropdownOpen ? '^' : 'v'}</Text>
              </Pressable>
              {arrayTypeDropdownOpen && (
                <View style={styles.dropdownList}>
                  <ScrollView nestedScrollEnabled={true} style={styles.dropdownInnerScroll}>
                    {arrayTypeOptions.map((opt) => (
                      <Pressable
                        key={opt.value}
                        style={styles.dropdownItem}
                        onPress={() => {
                          setPvDraftField('arrayType', opt.value);
                          setArrayTypeDropdownOpen(false);
                        }}
                      >
                        <View style={styles.checkbox}>
                          {pvDraftInputs.arrayType === opt.value && <Text style={styles.checkmark}>✓</Text>}
                        </View>
                        <Text style={styles.dropdownItemText}>{opt.label}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}
              </View>

              <View style={styles.selectorCard}>
              <Text style={styles.subLabel}>Module Type</Text>
              <Pressable
                style={[styles.dropdownButton, !pvFarmId && styles.dropdownButtonDisabled]}
                onPress={() => {
                  if (!pvFarmId) return;
                  setModuleTypeDropdownOpen(!moduleTypeDropdownOpen);
                }}
              >
                <Text style={styles.dropdownButtonText}>
                  {pvDraftInputs.moduleType
                    ? moduleTypeOptions.find((o) => o.value === pvDraftInputs.moduleType)?.label || pvDraftInputs.moduleType
                    : 'Select module type'}
                </Text>
                <Text style={styles.dropdownArrow}>{moduleTypeDropdownOpen ? '^' : 'v'}</Text>
              </Pressable>
              {moduleTypeDropdownOpen && (
                <View style={styles.dropdownList}>
                  <ScrollView nestedScrollEnabled={true} style={styles.dropdownInnerScroll}>
                    {moduleTypeOptions.map((opt) => (
                      <Pressable
                        key={opt.value}
                        style={styles.dropdownItem}
                        onPress={() => {
                          setPvDraftField('moduleType', opt.value);
                          setModuleTypeDropdownOpen(false);
                        }}
                      >
                        <View style={styles.checkbox}>
                          {pvDraftInputs.moduleType === opt.value && <Text style={styles.checkmark}>✓</Text>}
                        </View>
                        <Text style={styles.dropdownItemText}>{opt.label}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}
              </View>

              <Text style={styles.subLabel}>Losses (%)</Text>
              <TextInput
                style={styles.input}
                value={pvDraftInputs.losses}
                onChangeText={(text) => setPvDraftField('losses', text)}
                placeholder="e.g., 16 (Michigan: 14% base + snow)"
                placeholderTextColor={COLORS.placeholder}
                keyboardType="numeric"
              />

            </View>
          )}

          {/* ── Incentive / Credit Picker ── */}
          {siteIncludes === 'farming' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Credits & Incentives</Text>

              {incentivesLoading && (
                <Text style={styles.sectionSubtitle}>Loading programs…</Text>
              )}
              {!incentivesLoading && incentivesError && (
                <Text style={[styles.sectionSubtitle, { color: '#c0392b' }]}>
                  Could not load incentive catalog — {incentivesError}
                </Text>
              )}
              {!incentivesLoading && !incentivesError && incentiveCatalog.length === 0 && (
                <Text style={styles.sectionSubtitle}>No programs available.</Text>
              )}

              {!incentivesLoading && incentiveCatalog.length > 0 && (
              <>
              <View style={styles.selectorCard}>
              <Text style={styles.subLabel}>Select programs</Text>
              <Pressable
                style={styles.dropdownButton}
                onPress={() => setIncentiveDropdownOpen(!incentiveDropdownOpen)}
              >
                <Text style={styles.dropdownButtonText} numberOfLines={1}>
                  {selectedIncentiveIds.length === 0
                    ? 'None selected'
                    : selectedIncentiveIds.length === incentiveCatalog.length
                    ? 'All programs selected'
                    : `${selectedIncentiveIds.length} of ${incentiveCatalog.length} selected`}
                </Text>
                <Text style={styles.dropdownArrow}>{incentiveDropdownOpen ? '^' : 'v'}</Text>
              </Pressable>

              {incentiveDropdownOpen && (
                <View style={styles.dropdownList}>
                  {/* Select All / Clear All */}
                  <View style={styles.incentiveActions}>
                    <Pressable
                      style={styles.incentiveActionBtn}
                      onPress={() => setSelectedIncentiveIds(incentiveCatalog.map(i => i.id))}
                    >
                      <Text style={styles.incentiveActionText}>Select All</Text>
                    </Pressable>
                    <Pressable
                      style={styles.incentiveActionBtn}
                      onPress={() => setSelectedIncentiveIds([])}
                    >
                      <Text style={styles.incentiveActionText}>Clear All</Text>
                    </Pressable>
                  </View>
                  <ScrollView nestedScrollEnabled={true} style={styles.incentiveScroll}>
                    {incentiveCatalog.map((inc) => {
                      const selected = selectedIncentiveIds.includes(inc.id);
                      return (
                        <React.Fragment key={inc.id}>
                        <Pressable
                          style={[styles.incentiveRow, selected && styles.incentiveRowSelected]}
                          onPress={() => toggleIncentive(inc.id)}
                        >
                          <View style={styles.checkbox}>
                            {selected && <Text style={styles.checkmark}>✓</Text>}
                          </View>
                          <View style={styles.incentiveInfo}>
                            <Text style={styles.incentiveCat}>{inc.category}</Text>
                            <Text style={styles.incentiveLabel}>{inc.name}</Text>
                            <Text style={styles.incentiveDescText}>{inc.description}</Text>
                          </View>
                        </Pressable>
                        {/* Inline grant amount picker for brownfield */}
                        {inc.id === 'brownfield_egle' && selected && (
                          <View style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#1a2a1a', borderBottomWidth: 1, borderColor: '#2d5a27' }}>
                            <Text style={{ color: '#a8d5a2', fontSize: 12, fontWeight: '600', marginBottom: 5 }}>Grant Amount</Text>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                              {[100000, 250000, 500000, 750000, 1000000].map(amt => (
                                <Pressable
                                  key={amt}
                                  onPress={() => setIncentiveParams(p => ({ ...p, brownfield_egle_amount: amt }))}
                                  style={{
                                    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 5,
                                    backgroundColor: incentiveParams.brownfield_egle_amount === amt ? '#4CAF50' : '#2a3a2a',
                                    borderWidth: 1, borderColor: incentiveParams.brownfield_egle_amount === amt ? '#66BB6A' : '#3a4a3a',
                                  }}>
                                  <Text style={{ color: incentiveParams.brownfield_egle_amount === amt ? '#fff' : '#8a9a8a', fontSize: 12, fontWeight: '600' }}>
                                    ${(amt / 1000).toFixed(0)}K
                                  </Text>
                                </Pressable>
                              ))}
                            </View>
                          </View>
                        )}
                        </React.Fragment>
                      );
                    })}
                  </ScrollView>
                </View>
              )}
              </View>
              </>
              )}
            </View>
          )}

          {(siteIncludes === 'farming' || siteIncludes === 'grazing' || siteIncludes === 'neither') && (
            <Text style={styles.requiredText}>* Required fields</Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Bottom Control Panel */}
      <View style={styles.controlPanel}>
        {submitError ? (
          <Text style={styles.errorText}>{submitError}</Text>
        ) : null}
        <Pressable
          style={({ pressed }) => [
            styles.nextButton,
            (!isFormValid || submitLoading) && styles.nextButtonDisabled,
            pressed && isFormValid && !submitLoading && styles.nextButtonPressed,
          ]}
          onPress={handleNext}
          disabled={!isFormValid || submitLoading}
        >
          <Text style={[
            styles.nextButtonText,
            (!isFormValid || submitLoading) && styles.nextButtonTextDisabled,
          ]}>
            {submitLoading ? 'Running…' : 'Next'}
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
                  const pinCount = currentFarm?.pins?.length ?? currentFarm?.properties?.pinCount;

                  return (
                    <>
                <Text style={styles.selectedFarmName}>
                      {currentFarm?.properties?.name || `Farm ${currentIndex + 1}`}
                </Text>
                <Text style={styles.selectedFarmDetails}>
                      {pinCount} pins
                </Text>
                    <Text style={styles.selectedFarmArea}>
                      {acres?.toFixed(2)} acres ({sqMiles?.toFixed(4)} sq mi)
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
                    const currentFarm = baseFarm;
                    const coords = currentFarm?.geometry?.coordinates?.[0] || [];
                    const stableFarmId = getStableFarmId(currentFarm?.id, coords);
                    
                    if (!currentFarm || coords.length === 0) {
                      return <View style={[styles.viewTypeTile, { width: tileSize, height: tileSize }]} />;
                    }

                    const needsGrid = viewType.id !== 'satellite';
                    const gridResolution = currentFarm?.backendAnalysis?.metadata?.grid?.resolution;
                    const hasAnalysis = Boolean(currentFarm?.backendAnalysis?.solarSuitability || currentFarm?.backendAnalysis?.elevation);
                    const missingGrid = needsGrid && !Number.isFinite(gridResolution);
                    const analysisStatus = currentFarm?.analysisStatus;
                    const isLoadingReport = needsGrid && (missingGrid || !hasAnalysis || analysisStatus === 'running' || analysisStatus === 'queued' || analysisStatus === 'pending');
                    const loadingLabel =
                      analysisStatus === 'running' || analysisStatus === 'queued'
                        ? 'Analysis running…'
                        : analysisStatus === 'error'
                          ? 'Analysis failed'
                          : 'Loading report…';

                    if (isLoadingReport) {
                      return (
                        <Pressable
                          onPress={() => handleTilePress(viewType, currentIndex)}
                          style={[styles.viewTypeTile, { width: tileSize, height: tileSize }]}
                        >
                          <ActivityIndicator size="small" color={COLORS.accent} />
                          <Text style={styles.viewTypeLoadingText}>{loadingLabel}</Text>
                        </Pressable>
                      );
                    }
                    
                    // Get cached view data (computed only once per farm)
                    const viewData = !missingGrid || viewType.id === 'satellite'
                      ? getViewData(currentFarm.id, coords, tileSize - 10, viewType.id, { farm: currentFarm, gridResolution })
                      : null;
                    const polygonPoints = viewData?.polygonPoints || normalizePolygon(coords, tileSize - 10);
                    const tiles = viewData?.tiles || [];
                    const gridCells = viewData?.gridCells || [];
                    
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
                      }

                      if (missingGrid) {
                        return (
                          <Svg width={tileSize - 10} height={tileSize - 10} viewBox={`0 0 ${tileSize - 10} ${tileSize - 10}`}>
                            <Polygon points={polygonPoints} fill="none" stroke="#000000" strokeWidth={1.5} />
                          </Svg>
                        );
                      }

                      return (
                        <Svg width={tileSize - 10} height={tileSize - 10} viewBox={`0 0 ${tileSize - 10} ${tileSize - 10}`}>
                          <Defs>
                            <ClipPath id={`gridClip-${clipIdBase}`}>
                              <Polygon points={polygonPoints} />
                            </ClipPath>
                            <Pattern
                              id={`gridHash-${clipIdBase}`}
                              patternUnits="userSpaceOnUse"
                              width={4}
                              height={4}
                              patternTransform="rotate(45)"
                            >
                              <Path d="M0 0 L0 4" stroke="#000000" strokeWidth={1} />
                            </Pattern>
                          </Defs>
                          {gridCells
                            .slice()
                            .sort((a, b) => {
                              const rank = (cell) => (cell.isBoundary ? 2 : cell.isGuess ? 0 : 1);
                              return rank(a) - rank(b);
                            })
                            .map((cell) => (
                            <Rect
                              key={cell.key}
                              x={cell.x}
                              y={cell.y}
                              width={cell.width}
                              height={cell.height}
                              fill={
                                cell.fillColor
                                  ? cell.fillColor
                                  : cell.isBoundary
                                    ? COLORS.background
                                    : cell.isGuess
                                      ? `url(#gridHash-${clipIdBase})`
                                      : "none"
                              }
                              stroke={cell.isGuess ? "none" : COLORS.text}
                              strokeWidth={cell.isGuess ? 0 : cell.isBoundary ? 1.1 : 0.6}
                              clipPath={`url(#gridClip-${clipIdBase})`}
                            />
                          ))}
                          <Polygon points={polygonPoints} fill="none" stroke="#000000" strokeWidth={1.5} />
                        </Svg>
                      );
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
      {expandedModalVisible && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              {(() => {
                const baseFarm =
                  expandedFarmIndex !== null && builtFarms[expandedFarmIndex]
                    ? builtFarms[expandedFarmIndex]
                    : null;
                const currentFarm = baseFarm || null;
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
                    onPress={() => {
                      if (currentFarm) {
                        refreshFarmAnalysis(currentFarm);
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

                const currentFarm = builtFarms[expandedFarmIndex];
                const coords = currentFarm?.geometry?.coordinates?.[0] || [];
                // Make tile larger since it's the only one displayed
                const screenWidth = Dimensions.get('window').width;
                const screenHeight = Dimensions.get('window').height;
                const expandedTileSize = Math.min(screenWidth * 0.7, screenHeight * 0.5, 350);
                
                const expandedNeedsGrid = expandedViewType.id !== 'satellite';
                const expandedGridResolution = currentFarm?.backendAnalysis?.metadata?.grid?.resolution;
                const expandedHasAnalysis = Boolean(currentFarm?.backendAnalysis?.solarSuitability || currentFarm?.backendAnalysis?.elevation);
                const expandedMissingGrid = expandedNeedsGrid && !Number.isFinite(expandedGridResolution);

                // Get cached view data for the expanded tile size
                const viewData = !expandedMissingGrid || expandedViewType.id === 'satellite'
                  ? getViewData(currentFarm.id, coords, expandedTileSize, expandedViewType.id, { farm: currentFarm, gridResolution: expandedGridResolution })
                  : null;
                const polygonPoints = viewData?.polygonPoints || normalizePolygon(coords, expandedTileSize);
                const tiles = viewData?.tiles || [];
                const gridCells = viewData?.gridCells || [];
                
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
                  }

                  if (expandedMissingGrid || !expandedHasAnalysis) {
                    return (
                      <Svg width={expandedTileSize} height={expandedTileSize} viewBox={`0 0 ${expandedTileSize} ${expandedTileSize}`}>
                        <Polygon points={polygonPoints} fill="none" stroke="#000000" strokeWidth={2} />
                      </Svg>
                    );
                  }

                  return (
                    <Svg width={expandedTileSize} height={expandedTileSize} viewBox={`0 0 ${expandedTileSize} ${expandedTileSize}`}>
                      <Defs>
                        <ClipPath id={`gridClip-${clipIdBase}`}>
                          <Polygon points={polygonPoints} />
                        </ClipPath>
                        <Pattern
                          id={`gridHash-${clipIdBase}`}
                          patternUnits="userSpaceOnUse"
                          width={6}
                          height={6}
                          patternTransform="rotate(45)"
                        >
                          <Path d="M0 0 L0 6" stroke="#000000" strokeWidth={1} />
                        </Pattern>
                      </Defs>
                      {gridCells
                        .slice()
                        .sort((a, b) => {
                          const rank = (cell) => (cell.isBoundary ? 2 : cell.isGuess ? 0 : 1);
                          return rank(a) - rank(b);
                        })
                        .map((cell) => (
                        <Rect
                          key={cell.key}
                          x={cell.x}
                          y={cell.y}
                          width={cell.width}
                          height={cell.height}
                          fill={
                            cell.fillColor
                              ? cell.fillColor
                              : cell.isBoundary
                                ? COLORS.background
                                : cell.isGuess
                                  ? `url(#gridHash-${clipIdBase})`
                                  : "none"
                          }
                          stroke={cell.isGuess ? "none" : COLORS.text}
                          strokeWidth={cell.isGuess ? 0 : cell.isBoundary ? 1.6 : 1}
                          clipPath={`url(#gridClip-${clipIdBase})`}
                        />
                      ))}
                      <Polygon points={polygonPoints} fill="none" stroke="#000000" strokeWidth={2} />
                    </Svg>
                  );
                });
                
                return (
                  <View style={styles.modalTileContainer}>
                    {/* Cached SVG content */}
                    {cachedExpandedSvg}
                    {(expandedViewType.id === 'solar' || expandedViewType.id === 'elevation') && (
                      <View style={styles.viewDataRow}>
                        <Text style={styles.viewDataLabel}>Average:</Text>
                        <Text style={styles.viewDataValue}>
                          {expandedViewType.id === 'solar'
                            ? `${(currentFarm?.backendAnalysis?.solarSuitability?.summary?.averageSuitability ?? 0).toFixed(2)}%`
                            : `${(currentFarm?.backendAnalysis?.elevation?.summary?.averageElevation ?? 0).toFixed(2)} ft`}
                        </Text>
                      </View>
                    )}
                    {(expandedViewType.id === 'solar' || expandedViewType.id === 'elevation') && (
                      <View style={styles.legendContainer}>
                        <Svg width={220} height={12} viewBox="0 0 220 12" style={styles.legendBar}>
                          <Defs>
                            {expandedViewType.id === 'solar' ? (
                              <LinearGradient id="solarLegend" x1="0" y1="0" x2="1" y2="0">
                                <Stop offset="0" stopColor="#FF0000" />
                                <Stop offset="0.2" stopColor="#FFFF00" />
                                <Stop offset="0.4" stopColor="#00FF00" />
                                <Stop offset="0.6" stopColor="#00FFFF" />
                                <Stop offset="0.8" stopColor="#0000FF" />
                                <Stop offset="1" stopColor="#FF00FF" />
                              </LinearGradient>
                            ) : (
                              <LinearGradient id="elevationLegend" x1="0" y1="0" x2="1" y2="0">
                                <Stop offset="0" stopColor="#FF0000" />
                                <Stop offset="0.2" stopColor="#FFA500" />
                                <Stop offset="0.4" stopColor="#FFFF00" />
                                <Stop offset="0.6" stopColor="#008000" />
                                <Stop offset="1" stopColor="#0000FF" />
                              </LinearGradient>
                            )}
                          </Defs>
                          <Rect
                            x={0}
                            y={0}
                            width={220}
                            height={12}
                            rx={3}
                            fill={expandedViewType.id === 'solar' ? 'url(#solarLegend)' : 'url(#elevationLegend)'}
                          />
                        </Svg>
                        <View style={styles.legendLabelRow}>
                          <Text style={styles.legendLabel}>Low</Text>
                          <Text style={styles.legendLabel}>High</Text>
                        </View>
                      </View>
                    )}

                    {/* Solar Suitability Component Breakdown */}
                    {expandedViewType.id === 'solar' && (() => {
                      const summary = currentFarm?.backendAnalysis?.solarSuitability?.summary;
                      if (!summary) return null;
                      const ca = summary.componentAverages || {};
                      const rd = summary.rawDataRanges || {};
                      const insideCount = summary.insideSampleCount ?? 0;
                      const uniqueCount = summary.uniqueScoreCount ?? 0;
                      const COMPONENT_LABELS = {
                        land_cover: { label: 'Land Cover (NLCD)', weight: '40%' },
                        slope:      { label: 'Slope (LandFire)',  weight: '20%' },
                        transmission: { label: 'Transmission',    weight: '30%' },
                        population: { label: 'Population',        weight: '10%' },
                      };
                      return (
                        <View style={styles.solarDiagnosticBox}>
                          {/* Sampling info */}
                          <Text style={styles.solarDiagnosticHeader}>
                            {insideCount} in-boundary samples, {uniqueCount} unique score{uniqueCount !== 1 ? 's' : ''}
                          </Text>
                          {uniqueCount <= 3 && insideCount > 5 && (
                            <Text style={styles.solarDiagnosticNote}>
                              Most sample points scored identically — typical of uniform farmland where every grid cell falls into the same discrete bins.
                            </Text>
                          )}
                          {/* Per-component breakdown */}
                          <View style={styles.solarComponentTable}>
                            <View style={styles.solarComponentHeaderRow}>
                              <Text style={[styles.solarComponentCell, styles.solarComponentCellLabel, { fontWeight: '600' }]}>Factor</Text>
                              <Text style={[styles.solarComponentCell, { fontWeight: '600' }]}>Avg Score</Text>
                              <Text style={[styles.solarComponentCell, { fontWeight: '600' }]}>Weight</Text>
                            </View>
                            {Object.entries(COMPONENT_LABELS).map(([key, { label, weight }]) => {
                              const val = ca[key];
                              return (
                                <View key={key} style={styles.solarComponentRow}>
                                  <Text style={[styles.solarComponentCell, styles.solarComponentCellLabel]}>{label}</Text>
                                  <Text style={styles.solarComponentCell}>
                                    {val != null ? `${(val * 100).toFixed(0)}` : '—'}
                                  </Text>
                                  <Text style={styles.solarComponentCell}>{weight}</Text>
                                </View>
                              );
                            })}
                          </View>
                          {/* Raw data ranges */}
                          {(rd.slopePercent || rd.populationDensity || rd.substationDistMiles) && (
                            <View style={styles.solarRawRangesBox}>
                              <Text style={[styles.solarDiagnosticHeader, { marginTop: 0 }]}>Raw Data Ranges</Text>
                              {rd.slopePercent && (
                                <Text style={styles.solarRawRangeRow}>
                                  Slope: {rd.slopePercent.min.toFixed(2)}% – {rd.slopePercent.max.toFixed(2)}%
                                </Text>
                              )}
                              {rd.substationDistMiles && (
                                <Text style={styles.solarRawRangeRow}>
                                  Nearest Substation: {rd.substationDistMiles.min.toFixed(1)} – {rd.substationDistMiles.max.toFixed(1)} mi
                                </Text>
                              )}
                              {rd.populationDensity && (
                                <Text style={styles.solarRawRangeRow}>
                                  Population Density: {rd.populationDensity.min.toFixed(1)} – {rd.populationDensity.max.toFixed(1)} /km²
                                </Text>
                              )}
                            </View>
                          )}
                        </View>
                      );
                    })()}
                    
                    {/* Land Cover Report - gated by feature flag */}
                    {expandedViewType.id === 'satellite' && SHOW_SITE_PREP_REPORT && (() => {
                      const report = currentFarm?.backendAnalysis?.landcoverReport;
                      const clearingCost = currentFarm?.backendAnalysis?.clearingCost;
                      const nlcdClasses = Array.isArray(report?.nlcd?.classes) ? report.nlcd.classes : [];
                      const topClasses = nlcdClasses
                        .slice()
                        .sort((a, b) => (b?.percent ?? b?.percentOfFarm) - (a?.percent ?? a?.percentOfFarm))
                        .slice(0, 3);

                      const waterCoverageByTable = Array.isArray(report?.water?.coveragePercentByTable)
                        ? report.water.coveragePercentByTable
                        : [];

                      const additionalCoverageByTable = Array.isArray(report?.layers?.coveragePercentByTable)
                        ? report.layers.coveragePercentByTable
                        : [];

                      const estimatedTotalUsd = report?.sitePrepCost?.estimatedTotalUsd;
                      const waterPercent = report?.nlcd?.waterPercent;

                      const sortedCoverageRows = (() => {
                        const rows = [];

                        rows.push({
                          key: 'open-water',
                          label: 'Open Water (NLCD 11)',
                          value: `${waterPercent?.toFixed(1)}%`,
                        });

                        if (waterCoverageByTable.length > 0) {
                          waterCoverageByTable.forEach((row) => {
                            const rawName = row?.table ?? row?.table_name ?? 'unknown';
                            const label = String(rawName).replace(/^landcover_/, '').replace(/_/g, ' ');
                            rows.push({
                              key: `water-table-${rawName}`,
                              label,
                              value: `${row?.percent?.toFixed(1)}%`,
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
                              value: `${row?.percent?.toFixed(1)}%`,
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
                        <View style={styles.landCoverDetails}>
                          <View style={styles.landCoverHeader}>
                            <Text style={styles.landCoverTitle}>NLCD 2024 Land Cover</Text>
                            <Text style={[styles.landCoverSubtitle, { fontSize: 11, color: '#059669', marginTop: 2, fontWeight: '600' }]}>
                              Live landcover + Michigan pricing sources
                            </Text>
                          </View>

                          {!report && !clearingCost && (
                            <View style={styles.landCoverDetails}>
                              <View style={styles.landCoverRow}>
                                <Text style={styles.landCoverLabel}>Land cover:</Text>
                                <Text style={styles.landCoverValue}>Land cover data not available yet</Text>
                              </View>
                              <View style={styles.landCoverRow}>
                                <Text style={styles.landCoverLabel}>Clearing Cost:</Text>
                                <Text style={styles.landCoverValue}>Clearing Cost Unknown</Text>
                              </View>
                            </View>
                          )}

                          {!report && clearingCost && (
                            <>
                              <View style={styles.landCoverDetails}>
                                <View style={styles.landCoverRow}>
                                  <Text style={styles.landCoverLabel}>Estimated site prep:</Text>
                                  <Text style={styles.landCoverValue}>
                                    {formatUsd(clearingCost?.summary?.totalEstimatedCost)}
                                  </Text>
                                </View>
                              </View>

                              <View style={styles.landCoverEquationBox}>
                                <Text style={styles.landCoverEquationText}>
                                  <Text style={{ fontWeight: '700' }}>Pricing equations:</Text>
                                  {clearingCost?.equations
                                    ? `\n${Object.entries(clearingCost.equations)
                                        .map(([key, value]) => `${key}: ${value}`)
                                        .join('\n')}`
                                    : ' Not available'}
                                </Text>
                              </View>

                              <View style={styles.landCoverNotes}>
                                <Text style={styles.landCoverNotesText}>
                                  <Text style={{ fontWeight: '600' }}>Expected values: </Text>
                                  {clearingCost?.expectedValues
                                    ? Object.entries(clearingCost.expectedValues)
                                        .map(([key, value]) => `${key}=${Number(value).toFixed(2)}`)
                                        .join(' • ')
                                    : 'Not available'}
                                </Text>
                              </View>
                            </>
                          )}

                          {report && (
                            <>
                              {/* Estimated site-prep at the top */}
                              <View style={styles.landCoverDetails}>
                                <View style={styles.landCoverRow}>
                                  <Text style={styles.landCoverLabel}>Estimated site prep:</Text>
                                  <Text style={styles.landCoverValue}>{formatUsd(estimatedTotalUsd)}</Text>
                                </View>
                              </View>

                              {/* Percentages in blue box, with Top classes first (multiline) */}
                              <View style={styles.landCoverPercentagesBox}>
                                <View style={styles.landCoverRow}>
                                  <Text style={[styles.landCoverLabel, styles.landCoverBoxLabel]}>Top classes:</Text>
                                  <Text style={[styles.landCoverValue, styles.landCoverBoxValue, styles.landCoverValueMultiline]}>
                                    {topClasses.length > 0
                                      ? topClasses
                                          .map((c) => `${c.name} (${((c.percent ?? c.percentOfFarm))?.toFixed(1)}%)`)
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

                            </>
                          )}
                        </View>
                      );
                    })()}
                    
                    <Text style={styles.modalViewDescription}>{expandedViewType.description}</Text>
                  </View>
                );
              })()}
            </ScrollView>
          </View>
        </View>
      )}

        <Modal
          animationType="slide"
          transparent
          visible={modelPickerVisible}
          onRequestClose={() => setModelPickerVisible(false)}
        >
          <View style={styles.configModalOverlay}>
            <View style={styles.configModalCard}>
              <View style={styles.configModalHeader}>
                <Text style={styles.configModalTitle}>Choose model</Text>
                <Pressable style={styles.modalCloseButton} onPress={() => setModelPickerVisible(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              <ScrollView style={styles.configModalBody} contentContainerStyle={styles.configModalBodyContent}>
                <Pressable style={styles.rotationSaveButton} onPress={fetchModels}>
                  <Text style={styles.rotationSaveButtonText}>Refresh models</Text>
                </Pressable>
                {modelsLoading ? (
                  <View style={styles.dropdownLoadingRow}>
                    <ActivityIndicator size="small" color={COLORS.accent} />
                    <Text style={styles.dropdownEmptyText}>Loading models…</Text>
                  </View>
                ) : models.length === 0 ? (
                  <Text style={styles.dropdownEmptyText}>No models found</Text>
                ) : (
                  <View style={styles.configList}>
                    {models.map((model) => (
                      <View key={model.id} style={styles.configListItem}>
                        <View style={styles.configListInfo}>
                          <Text style={styles.configListName}>{model.name}</Text>
                          {model.description ? (
                            <Text style={styles.configListMeta}>{model.description}</Text>
                          ) : null}
                          {selectedModelId === model.id ? (
                            <Text style={styles.selectedModelTag}>Selected</Text>
                          ) : null}
                        </View>
                        <View style={styles.configListActions}>
                          <Pressable
                            style={styles.textButton}
                            onPress={() => {
                              setSelectedModelId(model.id);
                              setSelectedModel(model);
                              setModelPickerVisible(false);
                            }}
                          >
                            <Text style={styles.textButtonText}>Use</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

      <Modal
        animationType="slide"
        transparent
        visible={configModalVisible}
        onRequestClose={() => setConfigModalVisible(false)}
      >
        <View style={styles.configModalOverlay}>
          <View style={styles.configModalCard}>
            <View style={styles.configModalHeader}>
              <Text style={styles.configModalTitle}>Save / Load configuration</Text>
              <Pressable style={styles.modalCloseButton} onPress={() => setConfigModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>

            <ScrollView style={styles.configModalBody} contentContainerStyle={styles.configModalBodyContent}>
              <Text style={styles.label}>Save current configuration</Text>
              <TextInput
                style={styles.input}
                value={configName}
                onChangeText={setConfigName}
                placeholder="Enter a name (required)"
                placeholderTextColor={COLORS.placeholder}
              />
              {configError ? <Text style={styles.cropEditorError}>{configError}</Text> : null}
              <Pressable
                style={styles.rotationSaveButton}
                onPress={saveCurrentConfig}
              >
                <Text style={styles.rotationSaveButtonText}>Save configuration</Text>
              </Pressable>

              <Text style={[styles.label, { marginTop: 16 }]}>Saved configurations</Text>
              {configLoading ? (
                <View style={styles.dropdownLoadingRow}>
                  <ActivityIndicator size="small" color={COLORS.accent} />
                  <Text style={styles.dropdownEmptyText}>Loading configurations…</Text>
                </View>
              ) : savedConfigs.length === 0 ? (
                <Text style={styles.dropdownEmptyText}>No saved configurations yet</Text>
              ) : (
                <View style={styles.configList}>
                  {savedConfigs.map((config) => (
                    <View key={config.id} style={styles.configListItem}>
                      <View style={styles.configListInfo}>
                        <Text style={styles.configListName}>{config.name}</Text>
                        <Text style={styles.configListMeta}>{config.savedAt ? new Date(config.savedAt).toLocaleString() : ''}</Text>
                      </View>
                      <View style={styles.configListActions}>
                        <Pressable style={styles.textButton} onPress={() => loadConfig(config)}>
                          <Text style={styles.textButtonText}>Load</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.textButton, styles.dangerTextButton]}
                          onPress={() => confirmDeleteConfig(config)}
                        >
                          <Text style={[styles.textButtonText, styles.dangerText]}>Delete</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        transparent
        visible={cropEditorVisible}
        onRequestClose={closeCropEditor}
      >
        <View style={styles.cropModalOverlay}>
          <View style={styles.cropModalCard}>
            <View style={styles.cropModalHeader}>
              <Text style={styles.cropModalTitle}>Crop table</Text>
              <Pressable style={styles.modalCloseButton} onPress={closeCropEditor}>
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>

            <ScrollView style={styles.cropModalBody} contentContainerStyle={styles.cropModalBodyContent}>
              <Text style={styles.label}>{cropEditorMode === 'edit' ? 'Edit crop' : 'Add a new crop'}</Text>

              <View style={styles.inputGroup}>
                <Text style={styles.subLabel}>Name *</Text>
                <TextInput
                  style={styles.input}
                  value={cropForm.name}
                  onChangeText={(text) => setCropForm((prev) => ({ ...prev, name: text }))}
                  placeholder="e.g., Corn"
                  placeholderTextColor={COLORS.placeholder}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.subLabel}>Category</Text>
                <TextInput
                  style={styles.input}
                  value={cropForm.category}
                  onChangeText={(text) => setCropForm((prev) => ({ ...prev, category: text }))}
                  placeholder="e.g., Row crop"
                  placeholderTextColor={COLORS.placeholder}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.subLabel}>Unit *</Text>
                <TextInput
                  style={styles.input}
                  value={cropForm.unit}
                  onChangeText={(text) => setCropForm((prev) => ({ ...prev, unit: text }))}
                  placeholder="e.g., bushel"
                  placeholderTextColor={COLORS.placeholder}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.subLabel}>Yield per acre *</Text>
                <TextInput
                  style={styles.input}
                  value={cropForm.yield_per_acre}
                  onChangeText={(text) => setCropForm((prev) => ({ ...prev, yield_per_acre: text }))}
                  placeholder="e.g., 180"
                  placeholderTextColor={COLORS.placeholder}
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.subLabel}>Price per unit (year 0) *</Text>
                <TextInput
                  style={styles.input}
                  value={cropForm.price_per_unit_0}
                  onChangeText={(text) => setCropForm((prev) => ({ ...prev, price_per_unit_0: text }))}
                  placeholder="e.g., 4.2"
                  placeholderTextColor={COLORS.placeholder}
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.subLabel}>Cost per acre *</Text>
                <TextInput
                  style={styles.input}
                  value={cropForm.cost_per_acre}
                  onChangeText={(text) => setCropForm((prev) => ({ ...prev, cost_per_acre: text }))}
                  placeholder="e.g., 650"
                  placeholderTextColor={COLORS.placeholder}
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.subLabel}>Escalation rate</Text>
                <TextInput
                  style={styles.input}
                  value={cropForm.escalation_rate}
                  onChangeText={(text) => setCropForm((prev) => ({ ...prev, escalation_rate: text }))}
                  placeholder="e.g., 0.02"
                  placeholderTextColor={COLORS.placeholder}
                  keyboardType="numeric"
                />
              </View>

              {cropEditorError ? (
                <Text style={styles.cropEditorError}>{cropEditorError}</Text>
              ) : null}

              <View style={styles.cropModalActions}>
                <Pressable
                  style={[styles.rotationSaveButton, cropEditorSaving && styles.nextButtonDisabled]}
                  onPress={saveCropFromForm}
                  disabled={cropEditorSaving}
                >
                  <Text style={styles.rotationSaveButtonText}>{cropEditorMode === 'edit' ? 'Update crop' : 'Add crop'}</Text>
                </Pressable>
                <Pressable
                  style={[styles.secondaryButton, cropEditorSaving && styles.nextButtonDisabled]}
                  onPress={startNewCrop}
                  disabled={cropEditorSaving}
                >
                  <Text style={styles.secondaryButtonText}>Start new</Text>
                </Pressable>
              </View>

              <Text style={[styles.label, { marginTop: 12 }]}>Existing crops</Text>
              {cropOptions.length === 0 ? (
                <Text style={styles.dropdownEmptyText}>No crops available yet</Text>
              ) : (
                <View style={styles.cropList}>
                  {cropOptions.map((crop) => (
                    <View key={crop.id || crop.name} style={styles.cropListItem}>
                      <View style={styles.cropListInfo}>
                        <Text style={styles.cropListName}>{crop.name || crop.crop}</Text>
                        <Text style={styles.cropListMeta}>
                          {[crop.category, crop.unit].filter(Boolean).join(' • ') || 'No category'}
                        </Text>
                        <View style={styles.cropListStats}>
                          <Text style={styles.cropStatText}>Yield/acre: {formatNumber(crop.yield_per_acre)}</Text>
                          <Text style={styles.cropStatText}>Price/unit: {formatNumber(crop.price_per_unit_0)}</Text>
                          <Text style={styles.cropStatText}>Cost/acre: {formatNumber(crop.cost_per_acre)}</Text>
                          <Text style={styles.cropStatText}>Escalation: {formatNumber(crop.escalation_rate)}</Text>
                        </View>
                      </View>
                      <View style={styles.cropListActions}>
                        <Pressable style={styles.textButton} onPress={() => startEditCrop(crop)}>
                          <Text style={styles.textButtonText}>Edit</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.textButton, styles.dangerTextButton]}
                          onPress={() => confirmDeleteCrop(crop)}
                          disabled={cropEditorSaving}
                        >
                          <Text style={[styles.textButtonText, styles.dangerText]}>Delete</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              )}
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
    backgroundColor: COLORS.headerBg,
  },
  backButton: {
    position: 'absolute',
    top: 70,
    left: 20,
    zIndex: 100,
    width: 36,
    height: 36,
    borderRadius: 4,
    backgroundColor: COLORS.backBtnBg,
    borderWidth: 2,
    borderColor: COLORS.backBtnBorder,
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
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
    lineHeight: 20,
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 50 : 45,
    paddingBottom: 10,
    paddingHorizontal: 60,
    alignItems: 'center',
    backgroundColor: COLORS.headerBg,
    borderBottomWidth: 3,
    borderBottomColor: COLORS.headerBorder,
  },
  headerTitle: {
    fontSize: 20,
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
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 110,
  },
  inputGroup: {
    marginBottom: 16,
  },
  selectorCard: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: COLORS.inputBg,
    padding: 12,
    gap: 8,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.inputBg,
  },
  dropdownButtonText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
  },
  dropdownArrow: {
    color: COLORS.textLight,
    fontSize: 14,
    marginLeft: 8,
  },
  dropdownList: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 8,
    backgroundColor: COLORS.inputBg,
    maxHeight: 200,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
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
    fontSize: 14,
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
    borderColor: COLORS.borderLight,
    borderRadius: 3,
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
  },
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
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  rotationSaveButtonText: {
    color: COLORS.buttonText,
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButton: {
    marginTop: 12,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
  },
  cropEditorError: {
    color: '#C54B4B',
    fontSize: 14,
    marginTop: 6,
    marginBottom: 4,
  },
  cropModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  cropModalCard: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    width: '100%',
    maxHeight: '90%',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 8,
  },
  cropModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cropModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  cropModalBody: {
    flexGrow: 0,
  },
  cropModalBodyContent: {
    paddingBottom: 16,
  },
  cropModalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    marginBottom: 4,
  },
  cropList: {
    marginTop: 8,
    gap: 8,
  },
  cropListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.inputBg,
  },
  cropListInfo: {
    flex: 1,
    paddingRight: 8,
  },
  cropListName: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  cropListMeta: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 2,
  },
  cropListActions: {
    flexDirection: 'row',
    gap: 8,
  },
  cropListStats: {
    marginTop: 6,
    gap: 2,
  },
  cropStatText: {
    fontSize: 13,
    color: COLORS.text,
  },
  textButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  textButtonText: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  dangerText: {
    color: '#C54B4B',
  },
  dangerTextButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  configModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  configModalCard: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    width: '100%',
    maxHeight: '90%',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 8,
  },
  configModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  configModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  configModalBody: {
    flexGrow: 0,
  },
  configModalBodyContent: {
    paddingBottom: 16,
  },
  configList: {
    marginTop: 8,
    gap: 8,
  },
  configListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.inputBg,
  },
  configListInfo: {
    flex: 1,
    paddingRight: 8,
  },
  configListName: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  configListMeta: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  selectedModelTag: {
    marginTop: 6,
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  configListActions: {
    flexDirection: 'row',
    gap: 8,
  },
  checkmark: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.accent,
  },
  dropdownItemText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
  },
  dropdownEmptyText: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: COLORS.textLight,
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
  errorText: {
    color: '#C54B4B',
    fontSize: 14,
    marginBottom: 8,
    textAlign: 'center',
  },
  controlPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
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
  viewTypeLoadingText: {
    marginTop: 6,
    fontSize: 10,
    color: COLORS.textLight,
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
    zIndex: 9999,
    elevation: 9999,
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
  legendContainer: {
    marginTop: 10,
    alignItems: 'center',
    width: '100%',
  },
  legendBar: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 3,
  },
  legendLabelRow: {
    width: 220,
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  legendLabel: {
    fontSize: 11,
    color: COLORS.textLight,
  },
  // --- Solar suitability component diagnostic styles ---
  solarDiagnosticBox: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 8,
    width: '100%',
  },
  solarDiagnosticHeader: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  solarDiagnosticNote: {
    fontSize: 10,
    color: COLORS.textLight,
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: 6,
  },
  solarComponentTable: {
    marginTop: 4,
    gap: 2,
  },
  solarComponentHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 3,
    marginBottom: 2,
  },
  solarComponentRow: {
    flexDirection: 'row',
    paddingVertical: 2,
  },
  solarComponentCell: {
    flex: 1,
    fontSize: 10,
    color: COLORS.text,
    textAlign: 'center',
  },
  solarComponentCellLabel: {
    flex: 2,
    textAlign: 'left',
  },
  solarRawRangesBox: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  solarRawRangeRow: {
    fontSize: 10,
    color: COLORS.text,
    marginBottom: 2,
  },
  // --- end solar diagnostic styles ---
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
  // ── Incentive picker styles ──
  section: {
    marginTop: 18,
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 2,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: 10,
  },
  incentiveActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  incentiveActionBtn: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: COLORS.buttonBg,
    borderWidth: 1,
    borderColor: COLORS.buttonBorder,
  },
  incentiveActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.buttonText,
  },
  incentiveScroll: {
    maxHeight: 280,
  },
  incentiveRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  incentiveRowSelected: {
    backgroundColor: 'rgba(159, 232, 112, 0.08)',
  },
  incentiveInfo: {
    flex: 1,
  },
  incentiveCat: {
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.accent || '#B24636',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  incentiveLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 1,
  },
  incentiveDescText: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 2,
    lineHeight: 15,
  },
});

export default FarmDescriptionScreen;
