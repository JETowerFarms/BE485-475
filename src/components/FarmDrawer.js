import React, { useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Dimensions,
  ActivityIndicator,
  Platform,
} from 'react-native';
import Svg, {
  Polygon,
  Image as SvgImage,
  ClipPath,
  Defs,
  Rect,
  Pattern,
  Path,
} from 'react-native-svg';
import Carousel from 'react-native-reanimated-carousel';
import { interpolate } from 'react-native-reanimated';

import { COLORS, FARM_COLORS, VIEW_TYPES } from '../styles/theme';
import {
  getStableFarmId,
  normalizePolygon,
  getViewData,
  calculatePolygonArea,
} from '../utils/geometryUtils';

const DRAWER_WIDTH = Dimensions.get('window').width * 0.75;

// Animated right-side drawer with farm polygon + view-type carousels.
const FarmDrawer = ({
  open,
  onToggle,
  drawerAnim,
  builtFarms,
  currentIndex,
  onIndexChange,
  horizontalIndex,
  onHorizontalIndexChange,
  onTilePress,
}) => {
  const carouselRef = useRef(null);
  const horizontalCarouselRef = useRef(null);

  const tileSize = 120;
  const itemSpacing = tileSize - 20;
  const carouselHeight = itemSpacing * 3;
  const centerOffset = carouselHeight / 2 - tileSize / 2;

  const horizontalCarouselWidth = DRAWER_WIDTH * 0.75;
  const horizontalCenterOffset = horizontalCarouselWidth / 2 - tileSize / 2;

  const drawerTranslateX = drawerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [DRAWER_WIDTH, 0],
  });

  const carouselAnimationStyle = useCallback(
    (value) => {
      'worklet';
      const scale = interpolate(value, [-2, -1, 0, 1, 2], [0.5, 0.75, 1, 0.75, 0.5]);
      const opacity = interpolate(value, [-2, -1, 0, 1, 2], [0, 1, 1, 1, 0]);
      const translateY = interpolate(
        value,
        [-2, -1, 0, 1, 2],
        [
          centerOffset - itemSpacing * 1.8,
          centerOffset - itemSpacing * 0.9,
          centerOffset,
          centerOffset + itemSpacing * 0.7,
          centerOffset + itemSpacing * 1.3,
        ],
      );
      const zIndex = interpolate(value, [-2, -1, 0, 1, 2], [1, 5, 10, 5, 1]);
      return {
        transform: [{ translateY }, { scale }],
        opacity,
        zIndex: Math.round(zIndex),
      };
    },
    [itemSpacing, centerOffset],
  );

  const horizontalCarouselAnimationStyle = useCallback(
    (value) => {
      'worklet';
      const scale = interpolate(value, [-2, -1, 0, 1, 2], [0.5, 0.75, 1, 0.75, 0.5]);
      const opacity = interpolate(value, [-2, -1, 0, 1, 2], [0, 1, 1, 1, 0]);
      const translateX = interpolate(
        value,
        [-2, -1, 0, 1, 2],
        [
          horizontalCenterOffset - itemSpacing * 1.8,
          horizontalCenterOffset - itemSpacing * 0.9,
          horizontalCenterOffset,
          horizontalCenterOffset + itemSpacing * 0.7,
          horizontalCenterOffset + itemSpacing * 1.3,
        ],
      );
      const zIndex = interpolate(value, [-2, -1, 0, 1, 2], [1, 5, 10, 5, 1]);
      return {
        transform: [{ translateX }, { scale }],
        opacity,
        zIndex: Math.round(zIndex),
      };
    },
    [itemSpacing, horizontalCenterOffset],
  );

  const renderViewTypeTile = useCallback(
    ({ item: viewType, index }) => {
      const currentFarm = builtFarms[currentIndex] || null;
      const coords = currentFarm?.geometry?.coordinates?.[0] || [];
      const stableFarmId = getStableFarmId(currentFarm?.id, coords);

      if (!currentFarm || coords.length === 0) {
        return (
          <View style={[styles.viewTypeTile, { width: tileSize, height: tileSize }]} />
        );
      }

      const needsGrid = viewType.id !== 'satellite';
      const gridResolution = currentFarm?.backendAnalysis?.metadata?.grid?.resolution;
      const hasAnalysis = Boolean(
        currentFarm?.backendAnalysis?.solarSuitability ||
          currentFarm?.backendAnalysis?.elevation,
      );
      const missingGrid = needsGrid && !Number.isFinite(gridResolution);
      const analysisStatus = currentFarm?.analysisStatus;
      const isLoadingReport =
        needsGrid &&
        (missingGrid ||
          !hasAnalysis ||
          analysisStatus === 'running' ||
          analysisStatus === 'queued' ||
          analysisStatus === 'pending');
      const loadingLabel =
        analysisStatus === 'running' || analysisStatus === 'queued'
          ? 'Analysis running…'
          : analysisStatus === 'error'
            ? 'Analysis failed'
            : 'Loading report…';

      if (isLoadingReport) {
        return (
          <Pressable
            onPress={() => onTilePress(viewType, currentIndex)}
            style={[styles.viewTypeTile, { width: tileSize, height: tileSize }]}
          >
            <ActivityIndicator size="small" color={COLORS.accent} />
            <Text style={styles.viewTypeLoadingText}>{loadingLabel}</Text>
          </Pressable>
        );
      }

      let viewData = null;
      try {
        viewData =
          !missingGrid || viewType.id === 'satellite'
            ? getViewData(currentFarm.id, coords, tileSize - 10, viewType.id, {
                farm: currentFarm,
                gridResolution,
              })
            : null;
      } catch (_) {
        viewData = null;
      }

      const polygonPoints =
        viewData?.polygonPoints || normalizePolygon(coords, tileSize - 10);
      const tiles = viewData?.tiles || [];
      const gridCells = viewData?.gridCells || [];
      const clipIdBase = `${stableFarmId}-${viewType.id}`;

      const svgContent = (() => {
        if (viewType.id === 'satellite') {
          return (
            <Svg
              width={tileSize - 10}
              height={tileSize - 10}
              viewBox={`0 0 ${tileSize - 10} ${tileSize - 10}`}
            >
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
              <Polygon
                points={polygonPoints}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth={1.5}
              />
            </Svg>
          );
        }

        if (missingGrid) {
          return (
            <Svg
              width={tileSize - 10}
              height={tileSize - 10}
              viewBox={`0 0 ${tileSize - 10} ${tileSize - 10}`}
            >
              <Polygon
                points={polygonPoints}
                fill="none"
                stroke="#000000"
                strokeWidth={1.5}
              />
            </Svg>
          );
        }

        return (
          <Svg
            width={tileSize - 10}
            height={tileSize - 10}
            viewBox={`0 0 ${tileSize - 10} ${tileSize - 10}`}
          >
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
                          : 'none'
                  }
                  stroke={cell.isGuess ? 'none' : COLORS.text}
                  strokeWidth={
                    cell.isGuess ? 0 : cell.isBoundary ? 1.1 : 0.6
                  }
                  clipPath={`url(#gridClip-${clipIdBase})`}
                />
              ))}
            <Polygon
              points={polygonPoints}
              fill="none"
              stroke="#000000"
              strokeWidth={1.5}
            />
          </Svg>
        );
      })();

      return (
        <Pressable
          onPress={() => onTilePress(viewType, currentIndex)}
          style={[styles.viewTypeTile, { width: tileSize, height: tileSize }]}
        >
          {svgContent}
        </Pressable>
      );
    },
    [builtFarms, currentIndex, tileSize, onTilePress],
  );

  return (
    <Animated.View
      style={[styles.drawer, { transform: [{ translateX: drawerTranslateX }] }]}
    >
      <Pressable style={styles.drawerHandle} onPress={onToggle}>
        <View style={styles.drawerArrow}>
          <View
            style={[
              styles.arrowTop,
              { transform: [{ rotate: open ? '45deg' : '-45deg' }] },
            ]}
          />
          <View
            style={[
              styles.arrowBottom,
              { transform: [{ rotate: open ? '-45deg' : '45deg' }] },
            ]}
          />
        </View>
      </Pressable>

      <View style={styles.drawerContent}>
        <Text style={styles.drawerTitle}>Farm Details</Text>

        {builtFarms && builtFarms.length > 0 ? (
          <>
            <View style={styles.carouselContainer}>
              <Carousel
                ref={carouselRef}
                data={builtFarms}
                vertical
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
                onSnapToItem={onIndexChange}
                customAnimation={carouselAnimationStyle}
                renderItem={({ item, index }) => {
                  const coords = item.geometry?.coordinates?.[0] || [];
                  return (
                    <View
                      key={item.id}
                      style={[styles.polygonWrapper, { width: tileSize, height: tileSize }]}
                    >
                      <Svg
                        width={tileSize}
                        height={tileSize}
                        viewBox={`0 0 ${tileSize} ${tileSize}`}
                      >
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

            <View style={styles.selectedFarmInfo}>
              {(() => {
                const currentFarm = builtFarms[currentIndex] || null;
                const coords = currentFarm?.geometry?.coordinates?.[0] || [];
                const { acres, sqMiles } = calculatePolygonArea(coords);
                const pinCount =
                  currentFarm?.pins?.length ??
                  currentFarm?.properties?.pinCount;
                return (
                  <>
                    <Text style={styles.selectedFarmName}>
                      {currentFarm?.properties?.name || `Farm ${currentIndex + 1}`}
                    </Text>
                    <Text style={styles.selectedFarmDetails}>{pinCount} pins</Text>
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
                loop
                autoPlay={false}
                scrollAnimationDuration={300}
                onSnapToItem={onHorizontalIndexChange}
                customAnimation={horizontalCarouselAnimationStyle}
                renderItem={renderViewTypeTile}
              />
            </View>

            <View style={styles.selectedViewInfo}>
              <Text style={styles.selectedViewName}>
                {VIEW_TYPES[horizontalIndex]?.name || 'Unknown View'}
              </Text>
              <Text style={styles.viewDataSubtext}>Tap tile for more info</Text>
            </View>
          </>
        ) : (
          <Text style={styles.drawerEmptyText}>No farms added yet</Text>
        )}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
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
  drawerEmptyText: {
    fontSize: 14,
    color: COLORS.textLight,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 20,
  },
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
  viewTypeLoadingText: {
    marginTop: 6,
    fontSize: 10,
    color: COLORS.textLight,
    textAlign: 'center',
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
  viewDataSubtext: {
    fontSize: 10,
    color: COLORS.textLight,
    marginTop: 2,
    fontStyle: 'italic',
  },
});

export default FarmDrawer;
