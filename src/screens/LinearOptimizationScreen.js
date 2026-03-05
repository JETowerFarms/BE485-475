import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StatusBar,
  Pressable,
  TextInput,
  ScrollView,
  StyleSheet,
  Platform,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line, Rect, Circle, Text as SvgText, Polygon, G } from 'react-native-svg';
import { buildApiUrl } from '../config/apiConfig';

// Shared palette to match the rest of the app
const COLORS = {
  background: '#F5F0E6',      // cream – shared across the app
  headerBg: '#D4C4B0',        // warm tan header (matches farm screen buttons)
  headerBorder: '#8B8680',     // warm gray border – shared
  headerText: '#2C2C2C',      // near-black text – shared
  accentRed: '#B24636',        // rusty red accent for highlights
  text: '#2C2C2C',
  textLight: '#666666',
  infoBg: '#FFFDF8',
  border: '#8B8680',           // warm gray – shared
  borderLight: '#D4D0C4',
};

const LinearOptimizationScreen = ({ farms, onBack }) => {
  // Get analysis results from farms
  const analysisResults = useMemo(() => {
    console.log('[LinearOptimizationScreen] === PROCESSING FARMS FOR DISPLAY ===');
    console.log(`[LinearOptimizationScreen] Total farms received: ${farms?.length || 0}`);

    if (!farms) {
      console.log('[LinearOptimizationScreen] No farms provided');
      return [];
    }

    const results = farms
      .filter((farm) => farm.linearOptimization)
      .map((farm) => ({
        farmName: farm.properties?.name || `Farm ${farms.indexOf(farm) + 1}`,
        optimization: farm.linearOptimization,
        logs: farm.linearOptimizationLogs || null,
      }));

    console.log(`[LinearOptimizationScreen] Farms with analysis results: ${results.length}/${farms.length}`);
    results.forEach((result, index) => {
      const farm = farms.find(f => (f.properties?.name || `Farm ${farms.indexOf(f) + 1}`) === result.farmName);
      const analysisStatus = farm?.analysisStatus || 'unknown';
      console.log(`[LinearOptimizationScreen] Farm ${index + 1} (${result.farmName}): status=${analysisStatus}, outputLength=${result.output?.length || 0}`);
    });

    if (results.length === 0) {
      console.log('[LinearOptimizationScreen] No farms have analysis results to display');
    } else {
      console.log(`[LinearOptimizationScreen] Displaying results for ${results.length} farm(s)`);
    }

    return results;
  }, [farms]);

  const fmtMoney = (v) => (Number.isFinite(v) ? `$${v.toFixed(0)}` : '—');
  const fmtAcres = (v) => (Number.isFinite(v) ? `${v.toFixed(2)} ac` : '—');

  const [showMethodology, setShowMethodology] = useState(false);
  const [graphIndex, setGraphIndex] = useState(0);
  // Build a deck of graphs: one per farm/crop combination
  const graphDeck = useMemo(() => {
    if (analysisResults.length === 0) return [];

    const deck = [];
    analysisResults.forEach((result) => {
      const opt = result.optimization;
      if (!opt || typeof opt !== 'object') return;

      Object.keys(opt).forEach((cropName) => {
        const scenarios = opt[cropName] || {};
        const scenarioKeys = Object.keys(scenarios);
        if (scenarioKeys.length === 0) return;

        const first = scenarios[scenarioKeys[0]] || {};
        deck.push({
          farmName: result.farmName,
          cropName,
          cropLand: first.crop_land || 0,
          usableLand: first.usable_land || 0,
          maxSolar: first.max_solar || 0,
          scenarios: scenarioKeys.map((k) => ({
            label: k,
            solarAcres: scenarios[k]?.A_s || 0,
            cropAcres: scenarios[k]?.A_c_by_crop?.[cropName] || 0,
            farmerNPV: scenarios[k]?.objective_farmer_NPV || 0,
          })),
        });
      });
    });

    return deck;
  }, [analysisResults]);

  // Keep the current graph index in range when the deck changes
  useEffect(() => {
    setGraphIndex((idx) => {
      if (graphDeck.length === 0) return 0;
      return Math.min(idx, graphDeck.length - 1);
    });
  }, [graphDeck.length]);

  const currentGraph = graphDeck[graphIndex] || null;

  const renderGraph = () => {
    if (!currentGraph) {
      return <Text style={styles.placeholderText}>Run optimization to see the graph</Text>;
    }
    const { farmName, cropName, cropLand, usableLand, maxSolar, scenarios } = currentGraph;
    const W = Dimensions.get('window').width - 60;
    const H = 260;
    const pad = { top: 20, right: 20, bottom: 40, left: 50 };
    const gW = W - pad.left - pad.right;
    const gH = H - pad.top - pad.bottom;

    const maxX = Math.max(cropLand, usableLand, maxSolar, ...scenarios.map(s => s.solarAcres)) * 1.15 || 50;
    const maxY = Math.max(cropLand, ...scenarios.map(s => s.cropAcres)) * 1.15 || 50;

    const sx = (v) => pad.left + (v / maxX) * gW;
    const sy = (v) => pad.top + gH - (v / maxY) * gH;

    // Constraint lines
    const minAg = cropLand * 0.51 / (cropLand || 1) * cropLand;
    const solarCap = Math.min(maxSolar, usableLand);

    const GRAPH_COLORS = {
      axis: '#5A554E',
      grid: '#D4D0C4',
      coupling: '#8B8680',
      minAg: '#7A9A7A',
      solarCap: '#B24636',
      feasible: 'rgba(212,196,176,0.35)',
      dot30: '#F4A460',
      dot40: '#B24636',
      dot50: '#5A554E',
    };
    const dotColors = [GRAPH_COLORS.dot30, GRAPH_COLORS.dot40, GRAPH_COLORS.dot50];
    const xTicks = 5;
    const yTicks = 5;

    // Feasible region polygon
    const feasible = [];
    feasible.push([0, cropLand]);
    const s3x = Math.min(cropLand - minAg, solarCap);
    feasible.push([s3x, minAg]);
    if (solarCap < cropLand - minAg) {
      feasible.push([solarCap, cropLand - solarCap]);
    }
    const feasiblePoints = feasible.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ');

    return (
      <View style={styles.graphInner}>
        <Text style={styles.graphMeta}>{farmName} • {cropName}</Text>
        <Svg width={W} height={H}>
        {/* Grid lines */}
        {Array.from({ length: xTicks + 1 }, (_, i) => {
          const v = (maxX / xTicks) * i;
          return <Line key={`gx${i}`} x1={sx(v)} y1={pad.top} x2={sx(v)} y2={pad.top + gH} stroke={GRAPH_COLORS.grid} strokeWidth={0.5} />;
        })}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const v = (maxY / yTicks) * i;
          return <Line key={`gy${i}`} x1={pad.left} y1={sy(v)} x2={pad.left + gW} y2={sy(v)} stroke={GRAPH_COLORS.grid} strokeWidth={0.5} />;
        })}

        {/* Feasible region */}
        <Polygon points={feasiblePoints} fill={GRAPH_COLORS.feasible} stroke="none" />

        {/* Constraint: A_s + A_c = cropLand (coupling line) */}
        <Line x1={sx(0)} y1={sy(cropLand)} x2={sx(Math.min(cropLand, maxX))} y2={sy(Math.max(0, cropLand - Math.min(cropLand, maxX)))} stroke={GRAPH_COLORS.coupling} strokeWidth={2} strokeDasharray="6,3" />

        {/* Constraint: A_c >= minAg (horizontal line) */}
        <Line x1={sx(0)} y1={sy(minAg)} x2={sx(maxX)} y2={sy(minAg)} stroke={GRAPH_COLORS.minAg} strokeWidth={1.5} strokeDasharray="4,4" />

        {/* Constraint: A_s <= solarCap (vertical line) */}
        <Line x1={sx(solarCap)} y1={sy(0)} x2={sx(solarCap)} y2={sy(maxY)} stroke={GRAPH_COLORS.solarCap} strokeWidth={1.5} strokeDasharray="4,4" />

        {/* Axes */}
        <Line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + gH} stroke={GRAPH_COLORS.axis} strokeWidth={1.5} />
        <Line x1={pad.left} y1={pad.top + gH} x2={pad.left + gW} y2={pad.top + gH} stroke={GRAPH_COLORS.axis} strokeWidth={1.5} />

        {/* X tick labels */}
        {Array.from({ length: xTicks + 1 }, (_, i) => {
          const v = (maxX / xTicks) * i;
          return <SvgText key={`xt${i}`} x={sx(v)} y={pad.top + gH + 14} fontSize={9} fill={GRAPH_COLORS.axis} textAnchor="middle">{v.toFixed(0)}</SvgText>;
        })}
        {/* Y tick labels */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const v = (maxY / yTicks) * i;
          return <SvgText key={`yt${i}`} x={pad.left - 6} y={sy(v) + 3} fontSize={9} fill={GRAPH_COLORS.axis} textAnchor="end">{v.toFixed(0)}</SvgText>;
        })}

        {/* Axis labels */}
        <SvgText x={pad.left + gW / 2} y={H - 4} fontSize={11} fill={COLORS.text} textAnchor="middle" fontWeight="bold">Solar Acres (A_s)</SvgText>
        <SvgText x={12} y={pad.top + gH / 2} fontSize={11} fill={COLORS.text} textAnchor="middle" fontWeight="bold" rotation="-90" originX={12} originY={pad.top + gH / 2}>Crop Acres (A_c)</SvgText>

        {/* Optimal points per ITC scenario */}
        {scenarios.map((s, i) => (
          <G key={s.label}>
            <Circle cx={sx(s.solarAcres)} cy={sy(s.cropAcres)} r={6} fill={dotColors[i % dotColors.length]} stroke="#fff" strokeWidth={1.5} />
            <SvgText x={sx(s.solarAcres) + 9} y={sy(s.cropAcres) + 4} fontSize={9} fill={dotColors[i % dotColors.length]} fontWeight="bold">{s.label}</SvgText>
          </G>
        ))}

        {/* Legend labels for constraint lines */}
        <SvgText x={pad.left + gW - 2} y={pad.top + 12} fontSize={8} fill={GRAPH_COLORS.coupling} textAnchor="end">A_s + A_c = land</SvgText>
        <SvgText x={pad.left + gW - 2} y={pad.top + 22} fontSize={8} fill={GRAPH_COLORS.minAg} textAnchor="end">min ag</SvgText>
        <SvgText x={pad.left + gW - 2} y={pad.top + 32} fontSize={8} fill={GRAPH_COLORS.solarCap} textAnchor="end">solar cap</SvgText>
        </Svg>
      </View>
    );
  };

  const EQUATIONS = [
    { title: 'Solar CAPEX per acre', eq: 'CAPEX = (C_install / α) + C_site + C_grade + C_retill + C_bond + f_inter × (C_install / α)' },
    { title: 'Solar energy (year t)', eq: 'E_t = 8760 × CF × 1000 × (1 − d)^t × η_avail × η_curt × η_export' },
    { title: 'Solar revenue (year t)', eq: 'Rev_t = (E_t / α) × P_elec × (1 + g_elec)^t' },
    { title: 'Solar NPV (no lease)', eq: 'NPV_solar = Σ_{t=0…T} (Rev_t − Cost_t) / (1+r)^t' },
    { title: 'ITC benefit (year 2)', eq: 'ITC = CAPEX × itc_rate' },
    { title: 'Lease rate', eq: 'L = 0.88 × NPV_solar / Σ_{t=1…T} 1/(1+r)^t' },
    { title: 'Crop PV per acre', eq: 'PV_crop = Σ_{t=1…T} (yield × price_t − cost) / (1+r)^t' },
    { title: 'Objective (maximize)', eq: 'max z = PV_lease × A_s + Σ_j PV_crop_j × A_cj' },
    { title: 'Coupling constraint', eq: 'A_s + Σ A_cj = crop_land' },
    { title: 'Min agriculture', eq: 'Σ A_cj ≥ 0.51 × total_land' },
    { title: 'Solar cap', eq: 'A_s ≤ min(usable, prime_cap, zoning_cap, interconnect × α)' },
  ];

  const [equations, setEquations] = useState(EQUATIONS);

  useEffect(() => {
    const loadEquations = async () => {
      try {
        const resp = await fetch(buildApiUrl('/models/template'));
        const data = await resp.json();
        if (resp.ok && data?.template?.equations?.length) {
          setEquations(data.template.equations);
        }
      } catch (err) {
        // Leave defaults if fetch fails
      }
    };
    loadEquations();
  }, []);

  const renderScenario = (cropName, scenarioKey, scenario) => {
    const pvCrop = scenario.pv_crop_per_acre?.[cropName];
    return (
      <View key={scenarioKey} style={styles.scenarioCard}>
        <Text style={styles.scenarioTitle}>{scenarioKey} ITC</Text>
        <View style={styles.row}><Text style={styles.label}>Solar acres</Text><Text style={styles.value}>{fmtAcres(scenario.A_s)}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Crop acres</Text><Text style={styles.value}>{fmtAcres(scenario.A_c_by_crop?.[cropName])}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Developer NPV/ac (pre-lease)</Text><Text style={styles.value}>{fmtMoney(scenario.pv_solar_net_per_acre_no_lease)}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Developer NPV/ac (post-lease)</Text><Text style={styles.value}>{fmtMoney(scenario.pv_solar_net_per_acre_after_lease)}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Farmer lease (PV)</Text><Text style={styles.value}>{fmtMoney(scenario.pv_lease_per_acre)}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Farmer lease ($/ac/mo)</Text><Text style={styles.value}>{fmtMoney(scenario.lease_monthly_per_acre)}</Text></View>
        <View style={styles.row}><Text style={styles.label}>PV net crop ({cropName})</Text><Text style={styles.value}>{fmtMoney(pvCrop)}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Usable land</Text><Text style={styles.value}>{fmtAcres(scenario.usable_land)}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Objective (farmer NPV)</Text><Text style={styles.value}>{fmtMoney(scenario.objective_farmer_NPV)}</Text></View>
      </View>
    );
  };

  const renderReport = (optimization) => {
    // optimization shape: { [cropName]: { '30%': scenario, '40%': scenario, '50%': scenario } }
    if (!optimization || typeof optimization !== 'object') return null;
    const cropNames = Object.keys(optimization);
    return cropNames.map((crop) => {
      const scenarios = optimization[crop] || {};
      return (
        <View key={crop} style={styles.cropCard}>
          <Text style={styles.cropTitle}>{crop}</Text>
          <View style={styles.scenarioRow}>
            {Object.entries(scenarios).map(([key, scenario]) => renderScenario(crop, key, scenario))}
          </View>
        </View>
      );
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {/* Header */}
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          onPress={onBack}
        >
          <Text style={styles.backButtonText}>←</Text>
        </Pressable>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>Agrivoltaics Analysis Results</Text>
        </View>
      </View>

      {/* Graph Display Area */}
      <View style={styles.graphContainer}>
          <View style={styles.graphHeaderRow}>
            <Text style={styles.graphStackTitle}>
              {currentGraph ? `${currentGraph.farmName} — ${currentGraph.cropName}` : 'No graphs yet'}
            </Text>
            <View style={styles.graphNavRow}>
              <Text style={styles.graphCounter}>
                {graphDeck.length ? `${graphIndex + 1} / ${graphDeck.length}` : '0 / 0'}
              </Text>
              <Pressable
                style={({ pressed }) => [styles.graphNextButton, pressed && styles.buttonPressed, graphDeck.length <= 1 && styles.graphNextDisabled]}
                disabled={graphDeck.length <= 1}
                onPress={() => setGraphIndex((idx) => (graphDeck.length ? (idx + 1) % graphDeck.length : 0))}
              >
                <Text style={[styles.graphNextText, graphDeck.length <= 1 && styles.graphNextTextDisabled]}>Next ▷</Text>
              </Pressable>
            </View>
          </View>
        <View style={styles.graphWrapper}>
          {renderGraph()}
        </View>
        <View style={styles.methodRow}>
          <Pressable onPress={() => setShowMethodology(!showMethodology)} style={styles.methodToggle}>
            <Text style={styles.methodToggleText}>{showMethodology ? 'Hide Methodology' : 'Show Methodology'}</Text>
          </Pressable>
        </View>
        {showMethodology && (
          <ScrollView style={styles.methodPanel} nestedScrollEnabled>
            {equations.map((eq, i) => (
              <View key={i} style={styles.eqRow}>
                <Text style={styles.eqTitle}>{eq.title}</Text>
                <Text style={styles.eqText}>{eq.eq}</Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Info Display Area (40%) */}
      <ScrollView style={styles.infoContainer} contentContainerStyle={styles.infoContent}>
        {analysisResults.length === 0 ? (
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>No Analysis Results</Text>
            <Text style={styles.infoPlaceholder}>
              Analysis results will appear here after running the optimization.
            </Text>
          </View>
        ) : (
          analysisResults.map((result, index) => {
            console.log(`[LinearOptimizationScreen] Rendering result ${index + 1}/${analysisResults.length} for ${result.farmName}`);
            return (
              <View key={index} style={styles.infoCard}>
                <Text style={styles.infoTitle}>{result.farmName}</Text>
                <View style={styles.outputContainer}>
                  {renderReport(result.optimization)}
                  {/* Logs hidden per request */}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 50 : 45,
    paddingBottom: 15,
    paddingHorizontal: 20,
    backgroundColor: COLORS.headerBg,
    borderBottomWidth: 3,
    borderBottomColor: COLORS.headerBorder,
  },
  backButton: {
    position: 'absolute',
    left: 20,
    top: Platform.OS === 'ios' ? 50 : 45,
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
    color: COLORS.accentRed,
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
    lineHeight: 20,
  },
  headerContent: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.headerText,
    textAlign: 'center',
  },
  buttonPressed: {
    opacity: 0.6,
  },
  graphContainer: {
    backgroundColor: COLORS.background,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  graphHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    paddingHorizontal: 6,
  },
  graphStackTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    flexShrink: 1,
  },
  graphNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  graphCounter: {
    fontSize: 12,
    color: COLORS.textLight,
    minWidth: 48,
    textAlign: 'right',
    marginRight: 8,
  },
  graphNextButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: COLORS.headerBg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  graphNextDisabled: {
    opacity: 0.5,
  },
  graphNextText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
  },
  graphNextTextDisabled: {
    color: COLORS.textLight,
  },
  graphWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.infoBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
    minHeight: 200,
  },
  graphInner: {
    width: '100%',
    alignItems: 'center',
  },
  graphMeta: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: 4,
    textAlign: 'center',
  },
  placeholderText: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  methodRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
  },
  methodToggle: {
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 5,
    paddingHorizontal: 14,
    borderRadius: 6,
    backgroundColor: COLORS.headerBg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  methodToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
  },
  modelButton: {
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 5,
    paddingHorizontal: 14,
    borderRadius: 6,
    backgroundColor: COLORS.headerBg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  methodPanel: {
    maxHeight: 180,
    backgroundColor: COLORS.infoBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
    marginTop: 6,
  },
  eqRow: {
    marginBottom: 8,
  },
  eqTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 2,
  },
  eqText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: COLORS.textLight,
    lineHeight: 16,
  },
  infoContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  infoContent: {
    padding: 20,
    paddingTop: 15,
  },
  infoCard: {
    backgroundColor: COLORS.infoBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 15,
    marginBottom: 15,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 12,
  },
  infoPlaceholder: {
    fontSize: 14,
    color: COLORS.textLight,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  outputContainer: {
    backgroundColor: COLORS.infoBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
  },
  cropCard: {
    marginBottom: 12,
  },
  cropTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 8,
  },
  scenarioRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  scenarioCard: {
    flexGrow: 1,
    minWidth: 220,
    backgroundColor: '#111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
  },
  scenarioTitle: {
    color: '#F5E6C8',
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  label: {
    color: '#D3C7B6',
    fontSize: 12,
  },
  value: {
    color: '#9FE870',
    fontSize: 12,
    fontWeight: '600',
  },
  sectionLabel: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: 'bold',
    marginTop: 8,
    marginBottom: 6,
  },
  logsContainer: {
    marginTop: 12,
  },
  logBlock: {
    backgroundColor: '#0B0B0B',
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  logLabel: {
    color: '#FFD479',
    fontSize: 12,
    marginBottom: 4,
  },
  logText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: '#93E5FF',
    lineHeight: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  modalCard: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    width: '100%',
    maxHeight: '92%',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  modalCloseButton: {
    padding: 6,
  },
  modalCloseText: {
    fontSize: 16,
    color: COLORS.text,
  },
  modalBody: {
    flexGrow: 0,
  },
  modalBodyContent: {
    paddingBottom: 12,
  },
  modalHint: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: 8,
  },
  modalInput: {
    backgroundColor: COLORS.infoBg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 14,
    color: COLORS.text,
    marginBottom: 8,
  },
  modalTextArea: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  modalSectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 6,
    marginBottom: 4,
  },
  modalError: {
    color: '#B24636',
    fontSize: 13,
    marginTop: 4,
  },
  modalSuccess: {
    color: '#2E7D32',
    fontSize: 13,
    marginTop: 4,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 10,
  },
  modalButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.headerBg,
  },
  modalCancel: {
    backgroundColor: COLORS.infoBg,
  },
  modalPrimary: {
    backgroundColor: COLORS.headerBg,
  },
  modalDisabled: {
    opacity: 0.6,
  },
  modalButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
});

export default LinearOptimizationScreen;
