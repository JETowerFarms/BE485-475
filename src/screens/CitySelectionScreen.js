import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  TextInput,
  Modal,
  FlatList,
  PanResponder,
  Animated,
  Platform,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import Svg, { Path, G } from 'react-native-svg';
import mcdData from '../data/michiganMCDFull.json';

const SVG_WIDTH = 400;
const SVG_HEIGHT = 400;
const ASPECT_RATIO = 1;
const MIN_SCALE = 1;
const MAX_SCALE = 6;

const COLORS = {
  background: '#F5F0E6',
  text: '#2C2C2C',
  defaultFill: '#D4D0C4',
  selectedFill: '#5B8DB8',
  stroke: '#8B8680',
  shadow: 'rgba(0,0,0,0.15)',
};

// Four-color palette for map coloring (muted, professional tones)
const MAP_COLORS = [
  '#E8D4B8', // Warm beige
  '#C5D5C5', // Sage green  
  '#D4C4B0', // Tan
  '#B8C8D8', // Light blue-gray
];

const pointInPolygon = (point, polygon) => {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  const { x, y } = point;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
};

// Calculate polygon area using Shoelace formula (for sorting by size)
const calculatePolygonArea = (polygon) => {
  if (!polygon || polygon.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    area += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y);
  }
  return Math.abs(area / 2);
};

// Check if two GeoJSON geometries are adjacent (share boundary points)
const geometriesAdjacent = (geom1, geom2, tolerance = 0.001) => {
  // Extract all rings from both geometries (only outer rings for adjacency)
  const getRings = (geom) => {
    if (!geom) return [];
    if (geom.type === 'Polygon') {
      return [geom.coordinates[0]]; // Only outer ring
    } else if (geom.type === 'MultiPolygon') {
      return geom.coordinates.map(poly => poly[0]); // Only outer rings
    }
    return [];
  };
  
  const rings1 = getRings(geom1);
  const rings2 = getRings(geom2);
  
  // Build a set of points from rings2 for faster lookup
  const pointSet = new Set();
  for (const ring2 of rings2) {
    for (const p2 of ring2) {
      // Round coordinates to tolerance precision for comparison
      const key = `${Math.round(p2[0] / tolerance)}_${Math.round(p2[1] / tolerance)}`;
      pointSet.add(key);
    }
  }
  
  // Check if rings1 has at least 2 points matching rings2
  let sharedPoints = 0;
  for (const ring1 of rings1) {
    for (const p1 of ring1) {
      const key = `${Math.round(p1[0] / tolerance)}_${Math.round(p1[1] / tolerance)}`;
      if (pointSet.has(key)) {
        sharedPoints++;
        // Two shared points means they share an edge (adjacent)
        if (sharedPoints >= 2) return true;
      }
    }
  }
  
  return false;
};

// Build adjacency list from GeoJSON features and assign colors
const assignCityColorsFromGeoJSON = (features) => {
  const colorMap = {};
  const adjacency = {};
  const names = [];
  
  // Build list of city names and initialize adjacency (use namelsad for uniqueness)
  features.forEach(f => {
    const name = f.properties.namelsad || f.properties.name;
    names.push(name);
    adjacency[name] = [];
  });
  
  // Build adjacency list by checking all pairs
  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      const name1 = features[i].properties.namelsad || features[i].properties.name;
      const name2 = features[j].properties.namelsad || features[j].properties.name;
      
      if (geometriesAdjacent(features[i].geometry, features[j].geometry)) {
        adjacency[name1].push(name2);
        adjacency[name2].push(name1);
      }
    }
  }
  
  // Sort cities by number of neighbors (most constrained first - Welsh-Powell algorithm)
  const sortedNames = [...names].sort((a, b) => adjacency[b].length - adjacency[a].length);
  
  // Greedy coloring with sorted order
  for (const name of sortedNames) {
    const usedColors = new Set();
    for (const neighbor of adjacency[name]) {
      if (colorMap[neighbor] !== undefined) {
        usedColors.add(colorMap[neighbor]);
      }
    }
    // Assign first available color
    for (let c = 0; c < MAP_COLORS.length; c++) {
      if (!usedColors.has(c)) {
        colorMap[name] = c;
        break;
      }
    }
    // Fallback if all colors used (shouldn't happen with 4 colors on planar graph)
    if (colorMap[name] === undefined) {
      colorMap[name] = 0;
    }
  }
  
  return colorMap;
};

const CitySelectionScreen = ({ county, onNavigateBack, onNavigateToPin }) => {
  const [selectedCity, setSelectedCity] = useState(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [mapDimensions, setMapDimensions] = useState({ width: 300, height: 300 });
  const [displayScale, setDisplayScale] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const translateXAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(0)).current;

  const scale = useRef(1);
  const translateX = useRef(0);
  const translateY = useRef(0);
  const mapWidth = useRef(300);
  const mapHeight = useRef(300);

  const viewportRef = useRef(null);
  const viewportBounds = useRef({ x: 0, y: 0, width: 300, height: 300 });
  const gestureState = useRef({
    isAnimating: false,
    initialDistance: 0,
    initialScale: 1,
    initialTranslateX: 0,
    initialTranslateY: 0,
    focalX: 0,
    focalY: 0,
    lastPanX: 0,
    lastPanY: 0,
    touchStartX: 0,
    touchStartY: 0,
    touchStartTime: 0,
    lastTapTime: 0,
    lastTapX: 0,
    lastTapY: 0,
    hasMoved: false,
    touchCount: 0,
  });

  useEffect(() => {
    const listeners = [
      scaleAnim.addListener(({ value }) => { scale.current = value; setDisplayScale(value); }),
      translateXAnim.addListener(({ value }) => { translateX.current = value; }),
      translateYAnim.addListener(({ value }) => { translateY.current = value; }),
    ];
    return () => {
      scaleAnim.removeListener(listeners[0]);
      translateXAnim.removeListener(listeners[1]);
      translateYAnim.removeListener(listeners[2]);
    };
  }, []);

  const countyMCDs = useMemo(() => {
    if (!county || !mcdData || !mcdData.features) return [];
    return mcdData.features.filter(
      (f) => f.properties.county?.toLowerCase() === county.toLowerCase() &&
             f.properties.name !== 'County subdivisions not defined' &&
             f.properties.aland > 0 // Exclude water-only features
    );
  }, [county]);

  const cityList = useMemo(() => {
    return countyMCDs
      .map((f) => f.properties.namelsad || f.properties.name)
      .filter(Boolean)
      .sort();
  }, [countyMCDs]);

  const filteredCities = useMemo(() => {
    if (!searchText) return cityList;
    return cityList.filter((name) =>
      name.toLowerCase().includes(searchText.toLowerCase())
    );
  }, [cityList, searchText]);

  const bounds = useMemo(() => {
    if (countyMCDs.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    countyMCDs.forEach((f) => {
      if (f.properties.bbox) {
        const bbox = f.properties.bbox;
        minX = Math.min(minX, bbox.minLng);
        minY = Math.min(minY, bbox.minLat);
        maxX = Math.max(maxX, bbox.maxLng);
        maxY = Math.max(maxY, bbox.maxLat);
      }
    });
    if (minX === Infinity) return null;
    return { minX, minY, maxX, maxY };
  }, [countyMCDs]);

  const geoToSvg = useCallback((lon, lat) => {
    if (!bounds) return { x: 0, y: 0 };
    const padding = 20;
    const { minX, minY, maxX, maxY } = bounds;
    const geoWidth = maxX - minX;
    const geoHeight = maxY - minY;
    const latCorrection = Math.cos(((minY + maxY) / 2 * Math.PI) / 180);
    const correctedGeoWidth = geoWidth * latCorrection;
    const scaleX = (SVG_WIDTH - padding * 2) / correctedGeoWidth;
    const scaleY = (SVG_HEIGHT - padding * 2) / geoHeight;
    const geoScale = Math.min(scaleX, scaleY);
    const offsetX = padding + ((SVG_WIDTH - padding * 2 - correctedGeoWidth * geoScale) / 2);
    const offsetY = padding + ((SVG_HEIGHT - padding * 2 - geoHeight * geoScale) / 2);
    const x = offsetX + (lon - minX) * latCorrection * geoScale;
    const y = offsetY + (maxY - lat) * geoScale;
    return { x, y };
  }, [bounds]);

  const geometryToPath = useCallback((geometry) => {
    if (!geometry) return '';
    const processRing = (ring) =>
      ring.map((coord, i) => {
        const { x, y } = geoToSvg(coord[0], coord[1]);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      }).join(' ') + ' Z';
    if (geometry.type === 'Polygon') {
      return geometry.coordinates.map(processRing).join(' ');
    }
    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.map((poly) => poly.map(processRing).join(' ')).join(' ');
    }
    return '';
  }, [geoToSvg]);

  const cityPolygons = useMemo(() => {
    const polygons = countyMCDs.map((feature) => {
      const cityName = feature.properties.namelsad || feature.properties.name;
      const geometry = feature.geometry;
      const allPolygons = []; // Store ALL polygons for MultiPolygon geometries
      let totalArea = 0;
      
      if (geometry?.type === 'Polygon' && geometry.coordinates[0]) {
        const points = geometry.coordinates[0].map((coord) => geoToSvg(coord[0], coord[1]));
        allPolygons.push(points);
        totalArea = calculatePolygonArea(points);
      } else if (geometry?.type === 'MultiPolygon') {
        // Process ALL polygons in the MultiPolygon
        geometry.coordinates.forEach((polygon) => {
          if (polygon[0]) {
            const points = polygon[0].map((coord) => geoToSvg(coord[0], coord[1]));
            allPolygons.push(points);
            totalArea += calculatePolygonArea(points);
          }
        });
      }
      
      return { name: cityName, polygons: allPolygons, area: totalArea };
    });
    // Sort by area ascending - smallest cities first for hit testing priority
    return polygons.sort((a, b) => a.area - b.area);
  }, [countyMCDs, geoToSvg]);

  // Compute color assignments for cities (4-color theorem) using raw GeoJSON coordinates
  const [cityColorMap, setCityColorMap] = useState({});
  
  useEffect(() => {
    if (countyMCDs.length === 0) {
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    // Use setTimeout to allow the loading indicator to render before heavy computation
    const timeoutId = setTimeout(() => {
      const colors = assignCityColorsFromGeoJSON(countyMCDs);
      setCityColorMap(colors);
      setIsLoading(false);
    }, 50);
    
    return () => clearTimeout(timeoutId);
  }, [countyMCDs]);

  const findCityAtPoint = useCallback((svgX, svgY) => {
    for (const city of cityPolygons) {
      // Check ALL polygons for this city (handles MultiPolygon)
      for (const polygon of city.polygons) {
        if (pointInPolygon({ x: svgX, y: svgY }, polygon)) {
          return city.name;
        }
      }
    }
    return null;
  }, [cityPolygons]);

  const handleContainerLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    let w = Math.min(width - 20, height - 20, 400);
    let h = w * ASPECT_RATIO;
    mapWidth.current = w;
    mapHeight.current = h;
    setMapDimensions({ width: w, height: h });
  };

  const handleViewportLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    viewportBounds.current.width = width;
    viewportBounds.current.height = height;
    if (viewportRef.current?.measure) {
      viewportRef.current.measure((x, y, w, h, pageX, pageY) => {
        if (pageX != null && pageY != null) {
          viewportBounds.current.x = pageX;
          viewportBounds.current.y = pageY;
        }
      });
    }
  };

  const screenToSvg = (screenX, screenY) => {
    const bounds = viewportBounds.current;
    const w = mapWidth.current;
    const h = mapHeight.current;
    const s = scale.current;
    const tx = translateX.current;
    const ty = translateY.current;
    const localX = screenX - bounds.x;
    const localY = screenY - bounds.y;
    const cx = w / 2;
    const cy = h / 2;
    const mapX = (localX - cx) / s + cx - tx;
    const mapY = (localY - cy) / s + cy - ty;
    const svgX = (mapX / w) * SVG_WIDTH;
    const svgY = (mapY / h) * SVG_HEIGHT;
    return { svgX, svgY };
  };

  const clamp = (tx, ty, s) => {
    const w = mapWidth.current;
    const h = mapHeight.current;
    const maxTx = Math.max(0, w * (s - 1) / 2);
    const maxTy = Math.max(0, h * (s - 1) / 2);
    return {
      x: Math.max(-maxTx, Math.min(maxTx, tx)),
      y: Math.max(-maxTy, Math.min(maxTy, ty)),
    };
  };

  const resetZoom = () => {
    const gs = gestureState.current;
    if (gs.isAnimating) return;
    gs.isAnimating = true;
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, friction: 5 }),
      Animated.spring(translateXAnim, { toValue: 0, useNativeDriver: true, friction: 5 }),
      Animated.spring(translateYAnim, { toValue: 0, useNativeDriver: true, friction: 5 }),
    ]).start(() => { gs.isAnimating = false; });
  };

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const gs = gestureState.current;
    if (gs.isAnimating) return;
    const bounds = viewportBounds.current;
    const w = mapWidth.current;
    const h = mapHeight.current;
    const s = scale.current;
    const tx = translateX.current;
    const ty = translateY.current;
    const delta = -e.deltaY * 0.001;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s * (1 + delta)));
    const localX = e.clientX - bounds.x;
    const localY = e.clientY - bounds.y;
    const focalX = localX - w / 2;
    const focalY = localY - h / 2;
    const scaleRatio = newScale / s;
    let newTx = focalX * (1 - scaleRatio) + tx * scaleRatio;
    let newTy = focalY * (1 - scaleRatio) + ty * scaleRatio;
    const clamped = clamp(newTx, newTy, newScale);
    scaleAnim.setValue(newScale);
    translateXAnim.setValue(clamped.x);
    translateYAnim.setValue(clamped.y);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || !viewportRef.current) return;
    const element = viewportRef.current;
    element.addEventListener?.('wheel', handleWheel, { passive: false });
    return () => { element.removeEventListener?.('wheel', handleWheel); };
  }, [mapDimensions, handleWheel]);

  const handleTap = (x, y) => {
    const doHitTest = () => {
      const { svgX, svgY } = screenToSvg(x, y);
      const cityName = findCityAtPoint(svgX, svgY);
      if (cityName) {
        setSelectedCity(prev => prev === cityName ? null : cityName);
      }
    };
    if (viewportRef.current?.measure) {
      viewportRef.current.measure((fx, fy, w, h, pageX, pageY) => {
        if (pageX != null && pageY != null) {
          viewportBounds.current.x = pageX;
          viewportBounds.current.y = pageY;
        }
        doHitTest();
      });
    } else {
      doHitTest();
    }
  };

  const getDistance = (touches) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getCenter = (touches) => {
    const bounds = viewportBounds.current;
    const cx = (touches[0].pageX + touches[1].pageX) / 2 - bounds.x;
    const cy = (touches[0].pageY + touches[1].pageY) / 2 - bounds.y;
    return { x: cx, y: cy };
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const gs = gestureState.current;
        if (gs.isAnimating) return;
        const touches = evt.nativeEvent.touches;
        gs.touchCount = touches.length;
        gs.hasMoved = false;
        if (touches.length >= 1) {
          gs.touchStartX = touches[0].pageX;
          gs.touchStartY = touches[0].pageY;
          gs.touchStartTime = Date.now();
          gs.lastPanX = touches[0].pageX;
          gs.lastPanY = touches[0].pageY;
        }
        if (touches.length >= 2) {
          gs.hasMoved = true;
          gs.initialDistance = getDistance(touches);
          gs.initialScale = scale.current;
          gs.initialTranslateX = translateX.current;
          gs.initialTranslateY = translateY.current;
          const center = getCenter(touches);
          gs.focalX = center.x - mapWidth.current / 2;
          gs.focalY = center.y - mapHeight.current / 2;
        }
      },
      onPanResponderMove: (evt) => {
        const gs = gestureState.current;
        if (gs.isAnimating) return;
        const touches = evt.nativeEvent.touches;
        gs.touchCount = touches.length;
        if (touches.length >= 2 && gs.initialDistance === 0) {
          gs.hasMoved = true;
          gs.initialDistance = getDistance(touches);
          gs.initialScale = scale.current;
          gs.initialTranslateX = translateX.current;
          gs.initialTranslateY = translateY.current;
          const center = getCenter(touches);
          gs.focalX = center.x - mapWidth.current / 2;
          gs.focalY = center.y - mapHeight.current / 2;
        }
        if (touches.length >= 2 && gs.initialDistance > 0) {
          gs.hasMoved = true;
          const dist = getDistance(touches);
          const ratio = dist / gs.initialDistance;
          const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, gs.initialScale * ratio));
          const center = getCenter(touches);
          const newFocalX = center.x - mapWidth.current / 2;
          const newFocalY = center.y - mapHeight.current / 2;
          const scaleChange = newScale / gs.initialScale;
          let newTx = gs.focalX * (1 - scaleChange) + gs.initialTranslateX * scaleChange;
          let newTy = gs.focalY * (1 - scaleChange) + gs.initialTranslateY * scaleChange;
          newTx += newFocalX - gs.focalX;
          newTy += newFocalY - gs.focalY;
          const clamped = clamp(newTx, newTy, newScale);
          scaleAnim.setValue(newScale);
          translateXAnim.setValue(clamped.x);
          translateYAnim.setValue(clamped.y);
        } else if (touches.length === 1 && scale.current > 1) {
          const dx = touches[0].pageX - gs.lastPanX;
          const dy = touches[0].pageY - gs.lastPanY;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) gs.hasMoved = true;
          const newTx = translateX.current + dx;
          const newTy = translateY.current + dy;
          const clamped = clamp(newTx, newTy, scale.current);
          translateXAnim.setValue(clamped.x);
          translateYAnim.setValue(clamped.y);
          gs.lastPanX = touches[0].pageX;
          gs.lastPanY = touches[0].pageY;
        } else if (touches.length === 1) {
          const dx = Math.abs(touches[0].pageX - gs.touchStartX);
          const dy = Math.abs(touches[0].pageY - gs.touchStartY);
          if (dx > 10 || dy > 10) gs.hasMoved = true;
        }
      },
      onPanResponderRelease: (evt) => {
        const gs = gestureState.current;
        if (gs.isAnimating) return;
        const touches = evt.nativeEvent.touches;
        if (touches && touches.length > 0) {
          gs.lastPanX = touches[0].pageX;
          gs.lastPanY = touches[0].pageY;
          if (touches.length < 2) gs.initialDistance = 0;
          return;
        }
        const now = Date.now();
        const endX = evt.nativeEvent.pageX;
        const endY = evt.nativeEvent.pageY;
        const duration = now - gs.touchStartTime;
        if (!gs.hasMoved && duration < 300 && gs.touchCount <= 1) {
          const timeSinceLast = now - gs.lastTapTime;
          const distFromLast = Math.sqrt(Math.pow(endX - gs.lastTapX, 2) + Math.pow(endY - gs.lastTapY, 2));
          if (timeSinceLast < 300 && distFromLast < 30) {
            resetZoom();
            gs.lastTapTime = 0;
          } else {
            handleTap(endX, endY);
            gs.lastTapTime = now;
            gs.lastTapX = endX;
            gs.lastTapY = endY;
          }
        }
        gs.touchCount = 0;
        gs.initialDistance = 0;
        if (scale.current > 1 && scale.current < 1.05) resetZoom();
      },
      onPanResponderTerminate: () => {
        const gs = gestureState.current;
        gs.touchCount = 0;
        gs.initialDistance = 0;
        gs.hasMoved = false;
      },
    })
  ).current;

  const handleSearchSelect = (cityName) => {
    setSelectedCity(cityName);
    setSearchVisible(false);
    setSearchText('');
  };

  const handleNext = () => {
    if (selectedCity && onNavigateToPin) {
      onNavigateToPin(selectedCity);
    }
  };

  const { width: MAP_WIDTH, height: MAP_HEIGHT } = mapDimensions;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      
      {/* Back Arrow Button - Top Left */}
      <Pressable 
        style={({ pressed }) => [styles.backArrowButton, pressed && styles.backArrowButtonPressed]}
        onPress={onNavigateBack}
      >
        <Text style={styles.backArrowText}>←</Text>
      </Pressable>
      
      <View style={styles.content}>
        <View style={styles.mapOuter} onLayout={handleContainerLayout}>
          <View style={styles.mapWrapper}>
            {/* Search Button - top right like county map */}
            <Pressable 
              style={({ pressed }) => [styles.searchButtonOverlay, pressed && styles.buttonPressed]}
              onPress={() => setSearchVisible(true)}
            >
              <Text style={styles.searchButtonOverlayText}>Search your City</Text>
            </Pressable>
            {displayScale > 1.05 && (
              <View style={styles.zoomIndicator}>
                <Text style={styles.zoomText}>{displayScale.toFixed(1)}x</Text>
              </View>
            )}
            {/* Loading Overlay */}
            {isLoading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color="#5B8DB8" />
                <Text style={styles.loadingText}>Loading {county} County...</Text>
              </View>
            )}
            <View
              ref={viewportRef}
              style={[styles.mapViewport, { width: MAP_WIDTH, height: MAP_HEIGHT, opacity: isLoading ? 0.3 : 1 }]}
              onLayout={handleViewportLayout}
              {...panResponder.panHandlers}
              pointerEvents={isLoading ? 'none' : 'auto'}
            >
              <Animated.View
                style={[
                  styles.mapContainer,
                  { width: MAP_WIDTH, height: MAP_HEIGHT },
                  { transform: [
                    { scale: scaleAnim },
                    { translateX: translateXAnim },
                    { translateY: translateYAnim },
                  ]},
                ]}
              >
                <View style={styles.shadowContainer}>
                  <Svg width={MAP_WIDTH} height={MAP_HEIGHT} viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}>
                    <G transform="translate(5, 5)">
                      {countyMCDs.map((feature, index) => {
                        const pathData = geometryToPath(feature.geometry);
                        if (!pathData) return null;
                        return (
                          <Path
                            key={`shadow-${feature.properties.geoid || index}`}
                            d={pathData}
                            fill={COLORS.shadow}
                          />
                        );
                      })}
                    </G>
                  </Svg>
                </View>
                <Svg
                  width={MAP_WIDTH}
                  height={MAP_HEIGHT}
                  viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                  style={styles.mainMap}
                >
                  {countyMCDs.map((feature, index) => {
                    const cityName = feature.properties.namelsad || feature.properties.name;
                    const isSelected = selectedCity === cityName;
                    const pathData = geometryToPath(feature.geometry);
                    if (!pathData) return null;
                    const colorIndex = cityColorMap[cityName] ?? 0;
                    const fillColor = isSelected ? COLORS.selectedFill : MAP_COLORS[colorIndex];
                    return (
                      <Path
                        key={feature.properties.geoid || index}
                        d={pathData}
                        fill={fillColor}
                        stroke={COLORS.stroke}
                        strokeWidth={0.5}
                      />
                    );
                  })}
                </Svg>
              </Animated.View>
            </View>
            <Text style={styles.hint}>
              {Platform.OS === 'web' ? 'Tap to select  Scroll to zoom' : 'Tap to select  Pinch to zoom  Double-tap to reset'}
            </Text>
          </View>
        </View>
        <Text style={styles.instruction}>
          {selectedCity || `Select a city in ${county} County`}
        </Text>
        <Pressable
          style={({ pressed }) => [
            styles.nextButton, 
            !selectedCity && styles.nextButtonDisabled,
            pressed && !(!selectedCity) && styles.buttonPressed
          ]}
          onPress={handleNext}
          disabled={!selectedCity}
        >
          <Text style={[styles.nextButtonText, !selectedCity && styles.nextButtonTextDisabled]}>
            Next
          </Text>
        </Pressable>
        <Modal visible={searchVisible} animationType="slide" transparent={true} onRequestClose={() => setSearchVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Search Cities</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Type city name..."
                value={searchText}
                onChangeText={setSearchText}
                autoFocus
              />
              <FlatList
                data={filteredCities}
                keyExtractor={(item, index) => `${item}-${index}`}
                style={styles.cityList}
                showsVerticalScrollIndicator={true}
                persistentScrollbar={true}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.cityItem} onPress={() => handleSearchSelect(item)}>
                    <Text style={styles.cityItemText}>{item}</Text>
                  </TouchableOpacity>
                )}
              />
              <Pressable 
                style={({ pressed }) => [styles.modalCloseButton, pressed && styles.buttonPressed]} 
                onPress={() => setSearchVisible(false)}
              >
                <Text style={styles.modalCloseText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  backArrowButton: {
    position: 'absolute',
    top: 50,
    left: 15,
    zIndex: 100,
    width: 36,
    height: 36,
    borderRadius: 4,
    backgroundColor: '#5A554E',
    borderWidth: 2,
    borderColor: '#3D3A36',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 6,
  },
  backArrowButtonPressed: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    elevation: 0,
    transform: [{ translateY: 2 }],
  },
  backArrowText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mapOuter: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
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
  mapWrapper: {
    alignItems: 'center',
    position: 'relative',
  },
  mapViewport: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  shadowContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  mainMap: {
    position: 'relative',
  },
  zoomIndicator: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  zoomText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245, 240, 230, 0.8)',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#2C2C2C',
    fontWeight: '500',
  },
  searchButtonOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 10,
    backgroundColor: '#F5F0E6',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#A8A498',
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 6,
  },
  searchButtonOverlayText: {
    color: '#2C2C2C',
    fontSize: 12,
    fontWeight: '500',
  },
  hint: {
    marginTop: 8,
    fontSize: 12,
    color: '#888',
  },
  instruction: {
    fontSize: 24,
    fontWeight: '400',
    color: COLORS.text,
    textAlign: 'center',
    marginVertical: 10,
    paddingHorizontal: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    width: '90%',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  nextButton: {
    width: '90%',
    paddingVertical: 18,
    borderWidth: 2,
    borderColor: '#5A7A5A',
    backgroundColor: '#7A9A7A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 8,
  },
  nextButtonDisabled: {
    borderColor: '#A0A0A0',
    backgroundColor: COLORS.background,
    opacity: 0.6,
  },
  nextButtonText: {
    fontSize: 22,
    fontWeight: '500',
    color: '#FFFFFF',
    includeFontPadding: false,
    textAlignVertical: 'center',
    lineHeight: 22,
  },
  nextButtonTextDisabled: {
    color: '#A0A0A0',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    maxHeight: '70%',
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 20,
    borderWidth: 2,
    borderColor: '#5A554E',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 15,
    textAlign: 'center',
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#5A554E',
    borderRadius: 5,
    padding: 12,
    fontSize: 16,
    marginBottom: 15,
    backgroundColor: '#FFFFFF',
  },
  cityList: {
    maxHeight: 300,
  },
  cityItem: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  cityItemText: {
    fontSize: 16,
    color: COLORS.text,
  },
  modalCloseButton: {
    marginTop: 15,
    paddingVertical: 12,
    backgroundColor: '#A0522D',
    borderRadius: 5,
    alignItems: 'center',
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 8,
  },
  modalCloseText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  buttonPressed: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
    transform: [{ translateY: 2 }],
  },
});

export default CitySelectionScreen;
