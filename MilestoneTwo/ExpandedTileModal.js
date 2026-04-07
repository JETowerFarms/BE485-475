import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import Svg, {
  Polygon,
  Image as SvgImage,
  ClipPath,
  Defs,
  Rect,
  Pattern,
  Path,
  LinearGradient,
  Stop,
} from 'react-native-svg';

import { COLORS, SHOW_SITE_PREP_REPORT } from '../styles/theme';
import {
  getStableFarmId,
  normalizePolygon,
  getViewData,
  formatUsd,
} from '../utils/geometryUtils';

// Expanded tile overlay — satellite / solar / elevation view of a farm.
const ExpandedTileModal = ({
  visible,
  onClose,
  viewType,
  farm,
  farmIndex,
  loading,
  onRefresh,
}) => {
  if (!visible) return null;

  const screenWidth = Dimensions.get('window').width;
  const screenHeight = Dimensions.get('window').height;
  const expandedTileSize = Math.min(screenWidth * 0.7, screenHeight * 0.5, 350);

  const refreshDisabled = !farm || loading;

  const renderSvgContent = () => {
    if (!farm || !viewType) return null;

    const coords = farm?.geometry?.coordinates?.[0] || [];
    const expandedNeedsGrid = viewType.id !== 'satellite';
    const expandedGridResolution = farm?.backendAnalysis?.metadata?.grid?.resolution;
    const expandedHasAnalysis = Boolean(
      farm?.backendAnalysis?.solarSuitability || farm?.backendAnalysis?.elevation,
    );
    const expandedMissingGrid =
      expandedNeedsGrid && !Number.isFinite(expandedGridResolution);

    let viewData = null;
    try {
      viewData =
        !expandedMissingGrid || viewType.id === 'satellite'
          ? getViewData(farm.id, coords, expandedTileSize, viewType.id, {
              farm,
              gridResolution: expandedGridResolution,
            })
          : null;
    } catch (_) {
      viewData = null;
    }

    const polygonPoints =
      viewData?.polygonPoints || normalizePolygon(coords, expandedTileSize);
    const tiles = viewData?.tiles || [];
    const gridCells = viewData?.gridCells || [];
    const stableFarmId = getStableFarmId(farm?.id, coords);
    const clipIdBase = `${stableFarmId}-expanded`;

    if (viewType.id === 'satellite') {
      return (
        <Svg
          width={expandedTileSize}
          height={expandedTileSize}
          viewBox={`0 0 ${expandedTileSize} ${expandedTileSize}`}
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
            strokeWidth={2}
          />
        </Svg>
      );
    }

    if (expandedMissingGrid || !expandedHasAnalysis) {
      return (
        <Svg
          width={expandedTileSize}
          height={expandedTileSize}
          viewBox={`0 0 ${expandedTileSize} ${expandedTileSize}`}
        >
          <Polygon
            points={polygonPoints}
            fill="none"
            stroke="#000000"
            strokeWidth={2}
          />
        </Svg>
      );
    }

    return (
      <Svg
        width={expandedTileSize}
        height={expandedTileSize}
        viewBox={`0 0 ${expandedTileSize} ${expandedTileSize}`}
      >
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
            const rank = (cell) =>
              cell.isBoundary ? 2 : cell.isGuess ? 0 : 1;
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
              strokeWidth={cell.isGuess ? 0 : cell.isBoundary ? 1.6 : 1}
              clipPath={`url(#gridClip-${clipIdBase})`}
            />
          ))}
        <Polygon
          points={polygonPoints}
          fill="none"
          stroke="#000000"
          strokeWidth={2}
        />
      </Svg>
    );
  };

  const renderSolarBreakdown = () => {
    if (viewType?.id !== 'solar') return null;
    const summary = farm?.backendAnalysis?.solarSuitability?.summary;
    if (!summary) return null;

    const ca = summary.componentAverages || {};
    const rd = summary.rawDataRanges || {};
    const insideCount = summary.insideSampleCount ?? 0;
    const uniqueCount = summary.uniqueScoreCount ?? 0;

    const COMPONENT_LABELS = {
      land_cover: { label: 'Land Cover (NLCD)', weight: '40%' },
      slope: { label: 'Slope (LandFire)', weight: '20%' },
      transmission: { label: 'Transmission', weight: '30%' },
      population: { label: 'Population', weight: '10%' },
    };

    return (
      <View style={styles.solarDiagnosticBox}>
        <Text style={styles.solarDiagnosticHeader}>
          {insideCount} in-boundary samples, {uniqueCount} unique score
          {uniqueCount !== 1 ? 's' : ''}
        </Text>
        {uniqueCount <= 3 && insideCount > 5 && (
          <Text style={styles.solarDiagnosticNote}>
            Most sample points scored identically — typical of uniform farmland
            where every grid cell falls into the same discrete bins.
          </Text>
        )}
        <View style={styles.solarComponentTable}>
          <View style={styles.solarComponentHeaderRow}>
            <Text
              style={[
                styles.solarComponentCell,
                styles.solarComponentCellLabel,
                { fontWeight: '600' },
              ]}
            >
              Factor
            </Text>
            <Text style={[styles.solarComponentCell, { fontWeight: '600' }]}>
              Avg Score
            </Text>
            <Text style={[styles.solarComponentCell, { fontWeight: '600' }]}>
              Weight
            </Text>
          </View>
          {Object.entries(COMPONENT_LABELS).map(([key, { label, weight }]) => {
            const val = ca[key];
            return (
              <View key={key} style={styles.solarComponentRow}>
                <Text
                  style={[styles.solarComponentCell, styles.solarComponentCellLabel]}
                >
                  {label}
                </Text>
                <Text style={styles.solarComponentCell}>
                  {val != null ? `${(val * 100).toFixed(0)}` : '—'}
                </Text>
                <Text style={styles.solarComponentCell}>{weight}</Text>
              </View>
            );
          })}
        </View>

        {(rd.slopePercent || rd.populationDensity || rd.substationDistMiles) && (
          <View style={styles.solarRawRangesBox}>
            <Text style={[styles.solarDiagnosticHeader, { marginTop: 0 }]}>
              Raw Data Ranges
            </Text>
            {rd.slopePercent && (
              <Text style={styles.solarRawRangeRow}>
                Slope: {rd.slopePercent.min.toFixed(2)}% –{' '}
                {rd.slopePercent.max.toFixed(2)}%
              </Text>
            )}
            {rd.substationDistMiles && (
              <Text style={styles.solarRawRangeRow}>
                Nearest Substation: {rd.substationDistMiles.min.toFixed(1)} –{' '}
                {rd.substationDistMiles.max.toFixed(1)} mi
              </Text>
            )}
            {rd.populationDensity && (
              <Text style={styles.solarRawRangeRow}>
                Population Density: {rd.populationDensity.min.toFixed(1)} –{' '}
                {rd.populationDensity.max.toFixed(1)} /km²
              </Text>
            )}
          </View>
        )}
      </View>
    );
  };

  const renderLandCoverReport = () => {
    if (viewType?.id !== 'satellite') return null;
    if (!SHOW_SITE_PREP_REPORT) return null;

    const report = farm?.backendAnalysis?.landcoverReport;
    const clearingCost = farm?.backendAnalysis?.clearingCost;
    const nlcdClasses = Array.isArray(report?.nlcd?.classes)
      ? report.nlcd.classes
      : [];
    const topClasses = nlcdClasses
      .slice()
      .sort(
        (a, b) =>
          (b?.percent ?? b?.percentOfFarm) - (a?.percent ?? a?.percentOfFarm),
      )
      .slice(0, 3);
    const estimatedTotalUsd = report?.sitePrepCost?.estimatedTotalUsd;
    const waterPercent = report?.nlcd?.waterPercent;

    const waterCoverageByTable = Array.isArray(report?.water?.coveragePercentByTable)
      ? report.water.coveragePercentByTable
      : [];
    const additionalCoverageByTable = Array.isArray(
      report?.layers?.coveragePercentByTable,
    )
      ? report.layers.coveragePercentByTable
      : [];

    const sortedCoverageRows = (() => {
      const rows = [];
      rows.push({
        key: 'open-water',
        label: 'Open Water (NLCD 11)',
        value: `${waterPercent?.toFixed(1)}%`,
      });
      waterCoverageByTable.forEach((row) => {
        const rawName = row?.table ?? row?.table_name ?? 'unknown';
        const label = String(rawName)
          .replace(/^landcover_/, '')
          .replace(/_/g, ' ');
        rows.push({ key: `water-table-${rawName}`, label, value: `${row?.percent?.toFixed(1)}%` });
      });
      additionalCoverageByTable.forEach((row) => {
        const rawName = row?.table ?? row?.table_name ?? 'unknown';
        const label = String(rawName)
          .replace(/^landcover_/, '')
          .replace(/_/g, ' ');
        rows.push({ key: `layer-table-${rawName}`, label, value: `${row?.percent?.toFixed(1)}%` });
      });
      return rows.sort((a, b) =>
        String(a.label).localeCompare(String(b.label), undefined, {
          sensitivity: 'base',
        }),
      );
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
    const equationRowsToShow = (
      allEquationRows.filter((e) => preferredEquationIds.has(e?.id)).length > 0
        ? allEquationRows.filter((e) => preferredEquationIds.has(e?.id))
        : allEquationRows
    ).slice(0, 8);
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
          <Text
            style={[
              styles.landCoverSubtitle,
              { fontSize: 11, color: '#059669', marginTop: 2, fontWeight: '600' },
            ]}
          >
            Live landcover + Michigan pricing sources
          </Text>
        </View>

        {!report && !clearingCost && (
          <View style={styles.landCoverDetails}>
            <View style={styles.landCoverRow}>
              <Text style={styles.landCoverLabel}>Land cover:</Text>
              <Text style={styles.landCoverValue}>
                Land cover data not available yet
              </Text>
            </View>
          </View>
        )}

        {report && (
          <>
            <View style={styles.landCoverDetails}>
              <View style={styles.landCoverRow}>
                <Text style={styles.landCoverLabel}>Estimated site prep:</Text>
                <Text style={styles.landCoverValue}>
                  {formatUsd(estimatedTotalUsd)}
                </Text>
              </View>
            </View>
            <View style={styles.landCoverPercentagesBox}>
              <View style={styles.landCoverRow}>
                <Text style={[styles.landCoverLabel, styles.landCoverBoxLabel]}>
                  Top classes:
                </Text>
                <Text
                  style={[
                    styles.landCoverValue,
                    styles.landCoverBoxValue,
                    styles.landCoverValueMultiline,
                  ]}
                >
                  {topClasses.length > 0
                    ? topClasses
                        .map(
                          (c) =>
                            `${c.name} (${(c.percent ?? c.percentOfFarm)?.toFixed(1)}%)`,
                        )
                        .join('\n')
                    : 'No NLCD classes returned'}
                </Text>
              </View>
              {sortedCoverageRows.map((row) => (
                <View key={row.key} style={styles.landCoverRow}>
                  <Text style={[styles.landCoverLabel, styles.landCoverBoxLabel]}>
                    {row.label}:
                  </Text>
                  <Text style={[styles.landCoverValue, styles.landCoverBoxValue]}>
                    {row.value}
                  </Text>
                </View>
              ))}
            </View>
            <View style={styles.landCoverEquationBox}>
              <Text style={styles.landCoverEquationText}>
                <Text style={{ fontWeight: '700' }}>Pricing equations:</Text>
                {equationText ? `\n${equationText}` : ' Not available'}
              </Text>
            </View>
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
  };

  return (
    <View style={styles.overlay}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Refresh"
            style={({ pressed }) => [
              styles.headerIconBtn,
              pressed && styles.pressed,
              refreshDisabled && { opacity: 0.6 },
            ]}
            disabled={refreshDisabled}
            onPress={() => {
              if (farm) onRefresh(farm);
            }}
          >
            {loading ? (
              <ActivityIndicator size="small" color={COLORS.text} />
            ) : (
              <Text style={styles.headerIconText}>↻</Text>
            )}
          </Pressable>

          {farm && viewType && (
            <Text style={styles.title}>
              {viewType.name} -{' '}
              {farm?.properties?.name || `Farm ${(farmIndex ?? 0) + 1}`}
            </Text>
          )}

          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator
          persistentScrollbar
        >
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.accent} />
              <Text style={styles.loadingText}>Loading...</Text>
            </View>
          ) : (
            <View style={styles.tileContainer}>
              {renderSvgContent()}

              {(viewType?.id === 'solar' || viewType?.id === 'elevation') && (
                <View style={styles.viewDataRow}>
                  <Text style={styles.viewDataLabel}>Average:</Text>
                  <Text style={styles.viewDataValue}>
                    {viewType.id === 'solar'
                      ? `${(
                          farm?.backendAnalysis?.solarSuitability?.summary
                            ?.averageSuitability ?? 0
                        ).toFixed(2)}%`
                      : `${(
                          farm?.backendAnalysis?.elevation?.summary
                            ?.averageElevation ?? 0
                        ).toFixed(2)} ft`}
                  </Text>
                </View>
              )}

              {(viewType?.id === 'solar' || viewType?.id === 'elevation') && (
                <View style={styles.legendContainer}>
                  <Svg
                    width={220}
                    height={12}
                    viewBox="0 0 220 12"
                    style={styles.legendBar}
                  >
                    <Defs>
                      {viewType.id === 'solar' ? (
                        <LinearGradient id="solarLegend" x1="0" y1="0" x2="1" y2="0">
                          <Stop offset="0" stopColor="#FF0000" />
                          <Stop offset="0.2" stopColor="#FFFF00" />
                          <Stop offset="0.4" stopColor="#00FF00" />
                          <Stop offset="0.6" stopColor="#00FFFF" />
                          <Stop offset="0.8" stopColor="#0000FF" />
                          <Stop offset="1" stopColor="#FF00FF" />
                        </LinearGradient>
                      ) : (
                        <LinearGradient
                          id="elevationLegend"
                          x1="0"
                          y1="0"
                          x2="1"
                          y2="0"
                        >
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
                      fill={
                        viewType.id === 'solar'
                          ? 'url(#solarLegend)'
                          : 'url(#elevationLegend)'
                      }
                    />
                  </Svg>
                  <View style={styles.legendLabelRow}>
                    <Text style={styles.legendLabel}>Low</Text>
                    <Text style={styles.legendLabel}>High</Text>
                  </View>
                </View>
              )}

              {renderSolarBreakdown()}
              {renderLandCoverReport()}

              <Text style={styles.viewDescription}>
                {viewType?.description}
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
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
  content: {
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#C5D5C5',
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    textAlign: 'center',
  },
  headerIconBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconText: { fontSize: 18, fontWeight: 'bold', color: COLORS.text },
  pressed: { opacity: 0.7 },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 4,
    backgroundColor: '#C54B4B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold' },
  body: { flex: 1 },
  bodyContent: {
    alignItems: 'center',
    paddingTop: 1,
    paddingBottom: 8,
    paddingHorizontal: 6,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
  },
  loadingText: { marginTop: 12, fontSize: 16, color: COLORS.textLight },
  tileContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  viewDataRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  viewDataLabel: { fontSize: 11, color: COLORS.textLight, fontWeight: '500' },
  viewDataValue: { fontSize: 14, fontWeight: 'bold', marginTop: 2 },
  legendContainer: { marginTop: 10, alignItems: 'center', width: '100%' },
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
  legendLabel: { fontSize: 11, color: COLORS.textLight },
  viewDescription: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 2,
    textAlign: 'center',
    fontStyle: 'italic',
    paddingHorizontal: 6,
  },
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
  solarComponentTable: { marginTop: 4, gap: 2 },
  solarComponentHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 3,
    marginBottom: 2,
  },
  solarComponentRow: { flexDirection: 'row', paddingVertical: 2 },
  solarComponentCell: {
    flex: 1,
    fontSize: 10,
    color: COLORS.text,
    textAlign: 'center',
  },
  solarComponentCellLabel: { flex: 2, textAlign: 'left' },
  solarRawRangesBox: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  solarRawRangeRow: { fontSize: 10, color: COLORS.text, marginBottom: 2 },
  landCoverHeader: { alignItems: 'center', marginBottom: 6, gap: 6 },
  landCoverTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
  },
  landCoverSubtitle: { fontSize: 12, color: COLORS.textLight },
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
  landCoverEquationText: { fontSize: 10, color: '#FFFFFF', textAlign: 'left' },
  landCoverBoxLabel: { color: '#FFFFFF' },
  landCoverBoxValue: { color: '#FFFFFF' },
  landCoverValueMultiline: { textAlign: 'right', lineHeight: 14 },
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
  landCoverValue: { fontSize: 11, color: COLORS.text, flex: 1, textAlign: 'right' },
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
});

export default ExpandedTileModal;
