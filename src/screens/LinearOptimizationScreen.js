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
import { buildApiUrl, apiFetch } from '../config/apiConfig';

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
  // Back button (shared across all screens)
  backBtnBg: '#5A554E',
  backBtnBorder: '#3D3A36',
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
        modelId: farm.linearOptimizationModelId ?? null,
        modelName: farm.linearOptimizationModelName || null,
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
          scenarios: [{
            label: '#1',
            solarAcres: scenarios['#1']?.A_s || 0,
            cropAcres: scenarios['#1']?.A_c_by_crop?.[cropName] || 0,
            farmerNPV: scenarios['#1']?.objective_farmer_NPV || 0,
          }],
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
    {
      title: 'Solar CAPEX per acre',
      eq: 'CAPEX = (C_inst/alpha + C_site + C_grade + C_retile + C_bond\n'
        + '       + f_inter * C_inst/alpha) * (1 + f_soft)',
    },
    {
      title: 'Construction financing factor (IDC)',
      eq: 'CFF = 0.5*[1+(1-tau)*((1+r_con)^1.5-1)] + 0.5*[1+(1-tau)*((1+r_con)^0.5-1)]\n'
        + 'Cash CAPEX at t=0 and t=1 = CFF * CAPEX / 2 each',
    },
    {
      title: 'Solar energy (year t)',
      eq: 'E_t = 8760 * CF * 1000 * clip(dc_ratio,1.15) * (1-d)^(t-2)\n'
        + '    * eta_avail * eta_curt(t) * eta_export   [kWh/MWac/yr]',
    },
    {
      title: 'Curtailment (year t)',
      eq: 'eta_curt(t) = max(0, eta_curt_0 - c_inc * (t-2))',
    },
    {
      title: 'Revenue: PPA / merchant tail (year t)',
      eq: 'Rev_t = (E_t / alpha) * price_t\n'
        + 'price_t = ppa_price_kwh                   if t < 2 + ppa_years\n'
        + '        = P_elec_0*(1+g_elec)^t*(1-d_mer)  otherwise',
    },
    {
      title: 'O&M cost (escalating, year t)',
      eq: 'OM_t = OM_base*(1+g_om)^(t-2) + (veg+ins)*(1+g_opex)^(t-2)\n'
        + '     + prop_tax*(1+g_ptax)^(t-2)',
    },
    {
      title: 'MACRS 5-yr depreciation tax shield',
      eq: 'DepBasis = CAPEX * (1 - itc_rate/2)\n'
        + 'shield_t = DepBasis * MACRS[t-2] * tau_dev\n'
        + 'MACRS: 20%, 32%, 19.2%, 11.52%, 11.52%, 5.76%',
    },
    {
      title: 'ITC benefit (year 2)',
      eq: 'ITC = CAPEX * itc_rate  (30% base, up to 70% with adders)',
    },
    {
      title: 'Lease rate (annual $/acre)',
      eq: 'NPV_dev = sum_{t=0..T} (Rev_t - OM_t - DS + shield_t) / (1+r_dev)^t\n'
        + 'L = (1 - f_retain) * NPV_dev / sum_{t=1..T} (1+g_lease)^t/(1+r_farmer)^t\n'
        + 'L = clamp(L, L_min, L_max)   if bounds are set',
    },
    {
      title: 'Crop PV per acre',
      eq: 'PV_crop_j = sum_{t=1..T} (yield_j * price_jt - cost_j) / (1+r_farmer)^t\n'
        + 'where price_jt = price_j0 * (1 + g_crop_j)^t',
    },
    {
      title: 'Objective (maximize farmer NPV)',
      eq: 'max z = PV_lease * A_s + sum_j PV_crop_j * A_cj',
    },
    {
      title: 'Land coupling constraint',
      eq: 'A_s / (1 - setback) + sum_j A_cj = crop_land\n'
        + 'crop_land = total_land - easements - wetlands',
    },
    {
      title: 'Min agriculture (traditional crops)',
      eq: 'sum_j A_cj >= min_ag_frac * total_land',
    },
    {
      title: 'Solar panel-acres cap',
      eq: 'A_s <= min(usable, prime_cap, zoning_cap, interconnect_MW * alpha)\n'
        + 'where usable = crop_land * (1 - setback)',
    },
  ];

  const [equations, setEquations] = useState(EQUATIONS);

  useEffect(() => {
    const loadEquations = async () => {
      try {
        const resp = await apiFetch(buildApiUrl('/models/template'));
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

  const buildNarrative = (cropName, scenario) => {
    const fmt = (v) => Number.isFinite(v) ? `$${Math.round(v).toLocaleString()}` : '—';

    const A_s = scenario.A_s ?? 0;
    const A_c = scenario.A_c_by_crop?.[cropName] ?? 0;
    const cropLand = scenario.crop_land ?? (A_s + A_c);
    const usable = scenario.usable_land ?? 0;
    const maxSolar = scenario.max_solar ?? A_s;
    const pvLeasePerAc = scenario.pv_lease_per_acre ?? 0;
    const leaseAnnual = scenario.lease_annual_per_acre ?? 0;
    const leaseMonthly = scenario.lease_monthly_per_acre ?? 0;
    const pvCropPerAc = scenario.pv_crop_per_acre?.[cropName] ?? 0;
    const devPreLease = scenario.pv_solar_net_per_acre_no_lease ?? 0;
    const devPostLease = scenario.pv_solar_net_per_acre_after_lease ?? 0;
    const totalNPV = scenario.objective_farmer_NPV ?? 0;
    const eqip = scenario.eqip_one_time_benefit;
    const itc = scenario.effective_itc ?? 0;
    const totalLeasePV = pvLeasePerAc * A_s;
    const totalCropPV = pvCropPerAc * A_c;

    const interconnectMw = scenario.interconnect_capacity_mw ?? null;
    const minAgFraction = scenario.constraints_min_ag_fraction ?? 0.51;
    const setbackFraction = scenario.constraints_setback_fraction ?? 0.10;
    const capReasonCode = scenario.solar_cap_reason ?? null; // authoritative from backend LP

    // Use the backend's solar_cap_reason directly — it is set only when a constraint is
    // genuinely binding on A_s, so we don't need to guess from numeric tolerances here.
    const atSolarCap = A_s > 0 && capReasonCode != null;

    let capReason = null;
    if (atSolarCap) {
      // solar zone footprint = panel acres / (1 - setback)
      const solarZoneAcres = scenario.solar_zone_acres ?? (A_s / (1 - setbackFraction));
      const solarZonePct = (solarZoneAcres / cropLand * 100).toFixed(1);

      switch (capReasonCode) {
        case 'interconnect_cap':
          capReason = `the ${interconnectMw} MW interconnect cap (${A_s.toFixed(1)} panel ac = ${solarZoneAcres.toFixed(1)} ac zone at this site's panel density)`;
          break;
        case 'min_ag_fraction':
          capReason = `the minimum ${(minAgFraction * 100).toFixed(0)}% agriculture requirement — the solar zone occupies ${solarZonePct}% of the farm, leaving exactly ${(minAgFraction * 100).toFixed(0)}% for crops`;
          break;
        case 'usable_land_cap':
          capReason = `property setbacks (${(setbackFraction * 100).toFixed(0)}%), which reduce available panel land from ${cropLand.toFixed(1)} to ${usable.toFixed(1)} acres`;
          break;
        case 'prime_soil_cap':
          capReason = `a prime soil cap of ${maxSolar.toFixed(1)} panel acres`;
          break;
        case 'zoning_cap':
          capReason = `a zoning cap of ${maxSolar.toFixed(1)} panel acres`;
          break;
        default:
          capReason = `a project cap of ${maxSolar.toFixed(1)} acres`;
      }
    }

    let text = `Out of ${cropLand.toFixed(1)} farmable acres, the model allocates ${A_s.toFixed(2)} panel acres to solar and ${A_c.toFixed(2)} acres to ${cropName} farming.`;

    if (atSolarCap) {
      text += ` Solar is pushed to its maximum — constrained by ${capReason} — because the solar lease rate (${fmt(leaseAnnual)}/ac/yr) exceeds crop income on a present-value basis.`;
    }

    text += ` The ${A_c.toFixed(1)} crop acres satisfy the required minimum of ${(minAgFraction * 100).toFixed(0)}% agriculture.`;

    text += `\n\nThe solar developer earns ${fmt(devPreLease)}/ac in project NPV before the lease, retaining ${fmt(devPostLease)}/ac after paying you. You receive ${fmt(leaseAnnual)}/ac/yr (${fmt(leaseMonthly)}/ac/mo) in solar lease cash — worth ${fmt(pvLeasePerAc)}/ac in present value, totaling ${fmt(totalLeasePV)} across all ${A_s.toFixed(1)} solar acres. Your ${cropName} on the remaining land adds ${fmt(pvCropPerAc)}/ac, or ${fmt(totalCropPV)} total, in present-value net farm income.`;

    if (Number.isFinite(eqip) && eqip > 0) {
      text += ` A one-time EQIP conservation payment of ${fmt(eqip)} is also included.`;
    }

    if (itc > 0) {
      text += ` This scenario uses a ${(itc * 100).toFixed(0)}% ITC, boosting developer economics and supporting a higher lease rate to you.`;
    }

    const cropsOnlyNPV = cropLand * pvCropPerAc;
    const npvLift = totalNPV - cropsOnlyNPV;

    text += `\n\nYour combined net present value — lease income plus crop income${Number.isFinite(eqip) && eqip > 0 ? ' plus EQIP' : ''} — is ${fmt(totalNPV)}, which is ${fmt(npvLift)} more compared to ${fmt(cropsOnlyNPV)} when growing only crops across all ${cropLand.toFixed(1)} farmable acres.`;

    return text;
  };

  const renderScenario = (cropName, scenarioKey, scenario, modelMeta = {}) => {
    const pvCrop = scenario.pv_crop_per_acre?.[cropName];
    const displayName = scenario.scenario_name || `${scenarioKey} ITC`;
    const incentives = scenario.incentives_applied || [];
    const modelLabel = modelMeta.modelName || 'Default';
    const modelIdLabel = Number.isFinite(modelMeta.modelId)
      ? ` (ID: ${modelMeta.modelId})`
      : '';
    return (
      <View key={scenarioKey} style={styles.scenarioCard}>
        <Text style={styles.scenarioTitle}>{displayName}</Text>
        {incentives.length > 0 && (
          <View style={styles.incentiveList}>
            {incentives.map((inc) => (
              <View key={inc.id} style={styles.incentiveItem}>
                <Text style={styles.incentiveBadge}>{inc.category}</Text>
                <Text style={styles.incentiveName}>{inc.name}</Text>
                <Text style={styles.incentiveDesc}>{inc.description}</Text>
              </View>
            ))}
          </View>
        )}
        <View style={styles.row}><Text style={styles.label}>Solar acres</Text><Text style={styles.value}>{fmtAcres(scenario.A_s)}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Crop acres</Text><Text style={styles.value}>{fmtAcres(scenario.A_c_by_crop?.[cropName])}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Developer NPV/ac (pre-lease)</Text><Text style={styles.value}>{fmtMoney(scenario.pv_solar_net_per_acre_no_lease)}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Developer NPV/ac (post-lease)</Text><Text style={styles.value}>{fmtMoney(scenario.pv_solar_net_per_acre_after_lease)}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Farmer lease (PV)</Text><Text style={styles.value}>{fmtMoney(scenario.pv_lease_per_acre)}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Farmer lease ($/ac/mo)</Text><Text style={styles.value}>{fmtMoney(scenario.lease_monthly_per_acre)}</Text></View>
        <View style={styles.row}><Text style={styles.label}>PV net crop ({cropName})</Text><Text style={styles.value}>{fmtMoney(pvCrop)}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Usable land</Text><Text style={styles.value}>{fmtAcres(scenario.usable_land)}</Text></View>
        {Number.isFinite(scenario.eqip_one_time_benefit) && scenario.eqip_one_time_benefit > 0 && (
          <View style={styles.row}><Text style={styles.label}>EQIP one-time benefit</Text><Text style={styles.value}>{fmtMoney(scenario.eqip_one_time_benefit)}</Text></View>
        )}
        <View style={styles.row}><Text style={styles.label}>Objective (farmer NPV)</Text><Text style={styles.value}>{fmtMoney(scenario.objective_farmer_NPV)}</Text></View>
        {Array.isArray(scenario.annual_npv_table) && scenario.annual_npv_table.length > 0 && (
          <View style={styles.annualTableSection}>
            <Text style={styles.annualTableTitle}>Annual Cashflow &amp; NPV</Text>
            <View style={styles.annualTableScroll}>
              <View style={styles.annualTableInner}>
                <View style={styles.annualTableHeaderRow}>
                  <Text style={[styles.annualTableCell, styles.annualTableHeaderCell, { width: 50 }]}>Year</Text>
                  <Text style={[styles.annualTableCell, styles.annualTableHeaderCell, { width: 90 }]}>Lease</Text>
                  <Text style={[styles.annualTableCell, styles.annualTableHeaderCell, { width: 90 }]}>Crop</Text>
                  <Text style={[styles.annualTableCell, styles.annualTableHeaderCell, { width: 90 }]}>Total</Text>
                  <Text style={[styles.annualTableCell, styles.annualTableHeaderCell, { width: 90 }]}>Discounted</Text>
                  <Text style={[styles.annualTableCell, styles.annualTableHeaderCell, { width: 110 }]}>Cum. NPV</Text>
                </View>
                {scenario.annual_npv_table.map((row) => (
                  <View key={row.year} style={[styles.annualTableRow, row.year % 2 === 0 && styles.annualTableRowEven]}>
                    <Text style={[styles.annualTableCell, { width: 50 }]}>{row.year}</Text>
                    <Text style={[styles.annualTableCell, { width: 90 }]}>{fmtMoney(row.lease_income)}</Text>
                    <Text style={[styles.annualTableCell, { width: 90 }]}>{fmtMoney(row.crop_income)}</Text>
                    <Text style={[styles.annualTableCell, { width: 90 }]}>{fmtMoney(row.total_income)}</Text>
                    <Text style={[styles.annualTableCell, { width: 90 }]}>{fmtMoney(row.discounted_cashflow)}</Text>
                    <Text style={[styles.annualTableCell, { width: 110 }]}>{fmtMoney(row.cumulative_npv)}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}
        <Text style={styles.modelUsedParagraph}>{`Model used: ${modelLabel}${modelIdLabel}.`}</Text>
        <Text style={styles.narrativeParagraph}>{buildNarrative(cropName, scenario)}</Text>
      </View>
    );
  };

  const renderReport = (optimization, modelMeta = {}) => {
    // optimization shape: { [cropName]: { '#1': scenario, '#2': scenario, '#3': scenario } }
    if (!optimization || typeof optimization !== 'object') return null;
    const cropNames = Object.keys(optimization);
    return cropNames.map((crop) => {
      const scenarios = optimization[crop] || {};
      return (
        <View key={crop} style={styles.cropCard}>
          <Text style={styles.cropTitle}>{crop}</Text>
          <View style={styles.scenarioRow}>
            {scenarios['#1'] && renderScenario(crop, '#1', scenarios['#1'], modelMeta)}
          </View>
        </View>
      );
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.headerBg} />

      {/* Header */}
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          onPress={onBack}
        >
          <Text style={styles.backButtonText}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Agrivoltaics Analysis Results</Text>
      </View>

      <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.scrollContent}>
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
      </View>

      {/* Info Display Area */}
      <View style={[styles.infoContainer, styles.infoContent]}>
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
                <Text style={styles.infoMeta}>
                  {`Model used: ${result.modelName || 'Default'}${
                    Number.isFinite(result.modelId) ? ` (ID: ${result.modelId})` : ''
                  }`}
                </Text>
                <View style={styles.outputContainer}>
                  {renderReport(result.optimization, {
                    modelId: result.modelId,
                    modelName: result.modelName,
                  })}
                  {/* Logs hidden per request */}
                </View>
              </View>
            );
          })
        )}
      </View>
      </ScrollView>

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.headerBg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 50 : 45,
    paddingBottom: 10,
    paddingHorizontal: 16,
    backgroundColor: COLORS.headerBg,
    borderBottomWidth: 3,
    borderBottomColor: COLORS.headerBorder,
  },
  backButton: {
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
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.headerText,
    textAlign: 'center',
    marginRight: 36,
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
  scrollContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  infoContainer: {
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
    overflow: 'hidden',
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 12,
  },
  infoMeta: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: 8,
    fontWeight: '600',
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
    overflow: 'hidden',
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
    flexDirection: 'column',
    gap: 10,
  },
  scenarioCard: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 220,
    maxWidth: '100%',
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
    flexWrap: 'wrap',
  },
  incentiveList: {
    marginBottom: 8,
    borderLeftWidth: 2,
    borderLeftColor: '#9FE870',
    paddingLeft: 8,
  },
  incentiveItem: {
    marginBottom: 5,
  },
  incentiveBadge: {
    color: '#9FE870',
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  incentiveName: {
    color: '#F5E6C8',
    fontSize: 11,
    fontWeight: '600',
  },
  incentiveDesc: {
    color: '#B0A898',
    fontSize: 10,
    lineHeight: 14,
    flexWrap: 'wrap',
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
  narrativeParagraph: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#3A3A3A',
    color: '#B8B0A4',
    fontSize: 12,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  modelUsedParagraph: {
    marginTop: 8,
    color: '#E8E0D6',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  annualTableSection: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#3A3A3A',
    paddingTop: 8,
  },
  annualTableTitle: {
    color: '#E8E0D6',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  annualTableScroll: {
    maxHeight: 500,
    overflow: 'scroll',
  },
  annualTableInner: {
    minWidth: 520,
  },
  annualTableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#2A2520',
    borderBottomWidth: 1,
    borderBottomColor: '#5A554E',
  },
  annualTableRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333',
  },
  annualTableRowEven: {
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  annualTableCell: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontSize: 11,
    color: '#C8C0B4',
    textAlign: 'right',
  },
  annualTableHeaderCell: {
    fontWeight: '700',
    color: '#E8E0D6',
    fontSize: 10,
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
