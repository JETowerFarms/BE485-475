import React, { useState, useRef, useEffect } from 'react';
import { 
  View, 
  StyleSheet, 
  PanResponder, 
  Animated, 
  Text, 
  Platform,
  TouchableOpacity,
  Modal,
  TextInput,
  FlatList,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
} from 'react-native';
import Svg, { Path, G } from 'react-native-svg';
import { MICHIGAN_COUNTIES } from '../data/michiganCounties';

// SVG viewBox dimensions (must match the viewBox in SVG)
const SVG_WIDTH = 400;
const SVG_HEIGHT = 500;
const ASPECT_RATIO = SVG_HEIGHT / SVG_WIDTH; // 1.25

// Colors matching the reference design
const COLORS = {
  defaultFill: '#D4D0C4',
  defaultStroke: '#A8A498',
  selectedFill: '#5B8DB8',
  selectedStroke: '#4A7A9E',
  shadow: 'rgba(0,0,0,0.12)',
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;

// Simple SVG path parser - extracts points for hit testing
const parseSvgPath = (pathString) => {
  const points = [];
  const regex = /([ML])\s*([-\d.]+)[,\s]+([-\d.]+)/gi;
  let match;
  while ((match = regex.exec(pathString)) !== null) {
    points.push({ x: parseFloat(match[2]), y: parseFloat(match[3]) });
  }
  return points;
};

// Point-in-polygon test using ray casting algorithm
const pointInPolygon = (point, polygon) => {
  if (polygon.length < 3) return false;
  
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

// Pre-parse all county polygons for hit testing
const COUNTY_POLYGONS = MICHIGAN_COUNTIES.map(county => ({
  ...county,
  polygon: parseSvgPath(county.path),
}));

// Find which county contains the given point (in SVG coordinates)
const findCountyAtPoint = (svgX, svgY) => {
  for (const county of COUNTY_POLYGONS) {
    if (pointInPolygon({ x: svgX, y: svgY }, county.polygon)) {
      return county;
    }
  }
  return null;
};

const MichiganMap = ({ 
  selectedCounty = null,
  onCountyPress,
}) => {
  // State
  const [mapDimensions, setMapDimensions] = useState({ width: 300, height: 375 });
  const [displayScale, setDisplayScale] = useState(1);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  
  // Sorted county names for search
  const sortedCountyNames = MICHIGAN_COUNTIES
    .map(c => c.name)
    .sort((a, b) => a.localeCompare(b));
  
  // Filter counties based on search text
  const filteredCounties = sortedCountyNames.filter(name =>
    name.toLowerCase().includes(searchText.toLowerCase())
  );
  
  // Animated values (never change references)
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const translateXAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(0)).current;
  
  // Refs for current values (updated via listeners, accessed in gesture handlers)
  const scale = useRef(1);
  const translateX = useRef(0);
  const translateY = useRef(0);
  const mapWidth = useRef(300);
  const mapHeight = useRef(375);
  
  // Gesture state refs
  const viewportRef = useRef(null);
  const viewportBounds = useRef({ x: 0, y: 0, width: 300, height: 375 });
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

  // Sync animated values to refs
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

  // Container layout handler
  const handleContainerLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    let w = Math.min(width, height / ASPECT_RATIO, 400);
    let h = w * ASPECT_RATIO;
    mapWidth.current = w;
    mapHeight.current = h;
    setMapDimensions({ width: w, height: h });
  };

  // Viewport layout handler - get screen position
  const handleViewportLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    viewportBounds.current.width = width;
    viewportBounds.current.height = height;
    
    // Measure screen position
    if (viewportRef.current) {
      viewportRef.current.measure?.((x, y, w, h, pageX, pageY) => {
        if (pageX != null && pageY != null) {
          viewportBounds.current.x = pageX;
          viewportBounds.current.y = pageY;
        }
      });
    }
  };

  // Convert screen tap to SVG coordinates
  const screenToSvg = (screenX, screenY) => {
    const bounds = viewportBounds.current;
    const w = mapWidth.current;
    const h = mapHeight.current;
    const s = scale.current;
    const tx = translateX.current;
    const ty = translateY.current;
    
    // Screen to viewport-local
    const localX = screenX - bounds.x;
    const localY = screenY - bounds.y;
    
    // Viewport-local to map coordinates (reverse transform)
    // React Native applies transforms right-to-left: translateY, translateX, scale
    // Forward: screenPt = (mapPt + translate - center) * scale + center
    // Reverse: mapPt = (screenPt - center) / scale + center - translate
    const cx = w / 2;
    const cy = h / 2;
    const mapX = (localX - cx) / s + cx - tx;
    const mapY = (localY - cy) / s + cy - ty;
    
    // Map to SVG coordinates
    const svgX = (mapX / w) * SVG_WIDTH;
    const svgY = (mapY / h) * SVG_HEIGHT;
    
    return { svgX, svgY };
  };

  // Clamp translation to bounds
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

  // Reset zoom
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

  // Handle mouse wheel zoom (web only)
  const handleWheel = (e) => {
    e.preventDefault();
    const gs = gestureState.current;
    if (gs.isAnimating) return;

    const bounds = viewportBounds.current;
    const w = mapWidth.current;
    const h = mapHeight.current;
    const s = scale.current;
    const tx = translateX.current;
    const ty = translateY.current;

    // Zoom factor from wheel delta
    const delta = -e.deltaY * 0.001;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s * (1 + delta)));
    
    // Focal point (mouse position relative to viewport center)
    const localX = e.clientX - bounds.x;
    const localY = e.clientY - bounds.y;
    const focalX = localX - w / 2;
    const focalY = localY - h / 2;
    
    // Adjust translation to keep focal point stationary
    const scaleRatio = newScale / s;
    let newTx = focalX * (1 - scaleRatio) + tx * scaleRatio;
    let newTy = focalY * (1 - scaleRatio) + ty * scaleRatio;
    
    const clamped = clamp(newTx, newTy, newScale);
    scaleAnim.setValue(newScale);
    translateXAnim.setValue(clamped.x);
    translateYAnim.setValue(clamped.y);
  };

  // Attach wheel listener on web
  useEffect(() => {
    if (Platform.OS !== 'web' || !viewportRef.current) return;
    
    const element = viewportRef.current;
    element.addEventListener?.('wheel', handleWheel, { passive: false });
    
    return () => {
      element.removeEventListener?.('wheel', handleWheel);
    };
  }, [mapDimensions]);

  // Handle tap
  const handleTap = (x, y) => {
    // Re-measure viewport position before hit test
    const doHitTest = () => {
      const { svgX, svgY } = screenToSvg(x, y);
      const county = findCountyAtPoint(svgX, svgY);
      if (county && onCountyPress) {
        onCountyPress(county);
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

  // Touch distance
  const getDistance = (touches) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Touch center (viewport-local)
  const getCenter = (touches) => {
    const bounds = viewportBounds.current;
    const cx = (touches[0].pageX + touches[1].pageX) / 2 - bounds.x;
    const cy = (touches[0].pageY + touches[1].pageY) / 2 - bounds.y;
    return { x: cx, y: cy };
  };

  // PanResponder
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
        
        // Initialize pinch when second finger is added mid-gesture
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
          // Pinch zoom
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
          // Pan when zoomed
          const dx = touches[0].pageX - gs.lastPanX;
          const dy = touches[0].pageY - gs.lastPanY;
          
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
            gs.hasMoved = true;
          }
          
          const newTx = translateX.current + dx;
          const newTy = translateY.current + dy;
          const clamped = clamp(newTx, newTy, scale.current);
          translateXAnim.setValue(clamped.x);
          translateYAnim.setValue(clamped.y);
          
          gs.lastPanX = touches[0].pageX;
          gs.lastPanY = touches[0].pageY;
        } else if (touches.length === 1) {
          // Track movement for tap detection
          const dx = Math.abs(touches[0].pageX - gs.touchStartX);
          const dy = Math.abs(touches[0].pageY - gs.touchStartY);
          if (dx > 10 || dy > 10) {
            gs.hasMoved = true;
          }
        }
      },
      
      onPanResponderRelease: (evt) => {
        const gs = gestureState.current;
        if (gs.isAnimating) return;
        
        const touches = evt.nativeEvent.touches;
        
        // Still have fingers down
        if (touches && touches.length > 0) {
          gs.lastPanX = touches[0].pageX;
          gs.lastPanY = touches[0].pageY;
          if (touches.length < 2) {
            gs.initialDistance = 0;
          }
          return;
        }
        
        // All fingers up
        const now = Date.now();
        const endX = evt.nativeEvent.pageX;
        const endY = evt.nativeEvent.pageY;
        const duration = now - gs.touchStartTime;
        
        // Tap detection
        if (!gs.hasMoved && duration < 300 && gs.touchCount <= 1) {
          const timeSinceLast = now - gs.lastTapTime;
          const distFromLast = Math.sqrt(
            Math.pow(endX - gs.lastTapX, 2) + Math.pow(endY - gs.lastTapY, 2)
          );
          
          if (timeSinceLast < 300 && distFromLast < 30) {
            // Double tap - reset zoom
            resetZoom();
            gs.lastTapTime = 0;
          } else {
            // Single tap - select county
            handleTap(endX, endY);
            gs.lastTapTime = now;
            gs.lastTapX = endX;
            gs.lastTapY = endY;
          }
        }
        
        // Reset gesture state
        gs.touchCount = 0;
        gs.initialDistance = 0;
        
        // Snap back if barely zoomed
        if (scale.current > 1 && scale.current < 1.05) {
          resetZoom();
        }
      },
      
      onPanResponderTerminate: () => {
        const gs = gestureState.current;
        gs.touchCount = 0;
        gs.initialDistance = 0;
        gs.hasMoved = false;
      },
    })
  ).current;

  // Handle county selection from search
  const handleSearchSelect = (countyName) => {
    const county = MICHIGAN_COUNTIES.find(c => c.name === countyName);
    if (county && onCountyPress) {
      onCountyPress(county);
    }
    setSearchVisible(false);
    setSearchText('');
  };

  // Render helpers
  const isSelected = (name) => selectedCounty === name;
  const getFill = (county) => isSelected(county.name) ? COLORS.selectedFill : COLORS.defaultFill;
  const getStroke = (county) => isSelected(county.name) ? COLORS.selectedStroke : COLORS.defaultStroke;

  const { width: MAP_WIDTH, height: MAP_HEIGHT } = mapDimensions;

  if (MAP_WIDTH === 0 || MAP_HEIGHT === 0) {
    return (
      <View style={styles.container} onLayout={handleContainerLayout}>
        <Text style={styles.hint}>Loading map...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} onLayout={handleContainerLayout}>
      {/* Search Modal */}
      <Modal
        visible={searchVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSearchVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setSearchVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <KeyboardAvoidingView 
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.modalContent}
              >
                <Text style={styles.modalTitle}>Search County</Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Type county name..."
                  placeholderTextColor="#999"
                  value={searchText}
                  onChangeText={setSearchText}
                  autoFocus={true}
                />
                <FlatList
                  data={filteredCounties}
                  keyExtractor={(item) => item}
                  style={styles.countyList}
                  initialNumToRender={10}
                  maxToRenderPerBatch={10}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[
                        styles.countyItem,
                        selectedCounty === item && styles.countyItemSelected
                      ]}
                      onPress={() => handleSearchSelect(item)}
                    >
                      <Text style={[
                        styles.countyItemText,
                        selectedCounty === item && styles.countyItemTextSelected
                      ]}>
                        {item} County
                      </Text>
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    <Text style={styles.noResults}>No counties found</Text>
                  }
                />
                <TouchableOpacity 
                  style={styles.closeButton}
                  onPress={() => setSearchVisible(false)}
                >
                  <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
              </KeyboardAvoidingView>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
      
      <View style={styles.mapWrapper}>
        {/* Search Button - inside mapWrapper */}
        <TouchableOpacity 
          style={[styles.searchButton, { top: 8, right: 8 }]}
          onPress={() => setSearchVisible(true)}
        >
          <Text style={styles.searchButtonText}>Search your County</Text>
        </TouchableOpacity>
        
        {/* Zoom Indicator - inside mapWrapper */}
        {displayScale > 1.05 && (
          <View style={[styles.zoomIndicator, { top: 8, left: 8 }]}>
            <Text style={styles.zoomText}>{displayScale.toFixed(1)}x</Text>
          </View>
        )}
        
        <View 
          ref={viewportRef}
          style={[styles.mapViewport, { width: MAP_WIDTH, height: MAP_HEIGHT }]}
          onLayout={handleViewportLayout}
          {...panResponder.panHandlers}
        >
          <Animated.View
            style={[
              styles.mapContainer,
              { width: MAP_WIDTH, height: MAP_HEIGHT },
              {
                transform: [
                  { scale: scaleAnim },
                  { translateX: translateXAnim },
                  { translateY: translateYAnim },
                ],
              },
            ]}
          >
            <View style={styles.shadowContainer}>
              <Svg width={MAP_WIDTH} height={MAP_HEIGHT} viewBox="0 0 400 500">
                <G transform="translate(4, 4)">
                  {MICHIGAN_COUNTIES.map((county) => (
                    <Path
                      key={`shadow-${county.id}`}
                      d={county.path}
                      fill={COLORS.shadow}
                    />
                  ))}
                </G>
              </Svg>
            </View>
            
            <Svg
              width={MAP_WIDTH}
              height={MAP_HEIGHT}
              viewBox="0 0 400 500"
              style={styles.map}
            >
              <G>
                {MICHIGAN_COUNTIES.map((county) => (
                  <Path
                    key={county.id}
                    d={county.path}
                    fill={getFill(county)}
                    stroke={getStroke(county)}
                    strokeWidth={0.8}
                  />
                ))}
              </G>
            </Svg>
          </Animated.View>
        </View>
        
        <Text style={[styles.hint, { fontSize: Math.max(10, MAP_WIDTH * 0.032) }]}>
          {Platform.OS === 'web' 
            ? 'Tap county to select • Scroll to zoom' 
            : 'Tap county to select • Pinch to zoom • Double-tap to reset'}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
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
  map: {
    position: 'relative',
  },
  zoomIndicator: {
    position: 'absolute',
    top: 10,
    left: 10,
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
  hint: {
    marginTop: 8,
    fontSize: 12,
    color: '#888',
  },
  // Search button styles
  searchButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 10,
    backgroundColor: '#F5F0E6',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#A8A498',
  },
  searchButtonText: {
    color: '#2C2C2C',
    fontSize: 12,
    fontWeight: '500',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#F5F0E6',
    borderRadius: 8,
    padding: 16,
    width: '85%',
    maxWidth: 400,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2C2C2C',
    marginBottom: 12,
    textAlign: 'center',
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#A8A498',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#2C2C2C',
    marginBottom: 12,
  },
  countyList: {
    maxHeight: 300,
  },
  countyItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E0DCD4',
  },
  countyItemSelected: {
    backgroundColor: '#5B8DB8',
  },
  countyItemText: {
    fontSize: 16,
    color: '#2C2C2C',
  },
  countyItemTextSelected: {
    color: '#FFFFFF',
    fontWeight: '500',
  },
  noResults: {
    textAlign: 'center',
    color: '#888',
    paddingVertical: 20,
    fontSize: 14,
  },
  closeButton: {
    marginTop: 12,
    paddingVertical: 12,
    backgroundColor: '#A8A498',
    borderRadius: 4,
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
  },
});

export default MichiganMap;
