const NLCD_CLASS_INFO = {
  11: { name: 'Open Water', group: 'water' },
  21: { name: 'Developed, Open Space', group: 'developed' },
  22: { name: 'Developed, Low Intensity', group: 'developed' },
  23: { name: 'Developed, Medium Intensity', group: 'developed' },
  24: { name: 'Developed, High Intensity', group: 'developed' },
  31: { name: 'Barren Land', group: 'barren' },
  41: { name: 'Deciduous Forest', group: 'forest' },
  42: { name: 'Evergreen Forest', group: 'forest' },
  43: { name: 'Mixed Forest', group: 'forest' },
  52: { name: 'Shrub/Scrub', group: 'shrub' },
  71: { name: 'Grassland/Herbaceous', group: 'grass' },
  81: { name: 'Pasture/Hay', group: 'ag' },
  82: { name: 'Cultivated Crops', group: 'ag' },
  90: { name: 'Woody Wetlands', group: 'wetlands' },
  95: { name: 'Emergent Herbaceous Wetlands', group: 'wetlands' },
};

// Non-price mapping from landcover groups to the MSU Summary operation we use as a proxy.
// Prices must come from live MSU PDF extraction (per-acre totals).
const SITE_PREP_MODEL_BY_GROUP = {
  water: { operation: 'zero' },
  ag: { operation: 'stalkShredder20Ft' },
  grass: { operation: 'rotaryMowerConditioner12Ft' },
  shrub: { operation: 'rotaryMowerConditioner12Ft' },
  barren: { operation: 'rotaryMowerConditioner12Ft' },
  forest: { operation: 'mdotVegetation' },
  developed: { operation: 'mdotDeveloped' },
  wetlands: { operation: 'mdotVegetation' },
  unknown: { operation: 'rotaryMowerConditioner12Ft' },
};

function meanBeta(alpha, beta) {
  const a = Number(alpha);
  const b = Number(beta);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  return a / (a + b);
}

function lognormalMuForMean(mean, sigma) {
  const m = Number(mean);
  const s = Number(sigma);
  if (!Number.isFinite(m) || m <= 0 || !Number.isFinite(s) || s <= 0) return null;
  return Math.log(m) - 0.5 * s * s;
}

function meanLogNormal(mu, sigma) {
  const m = Number(mu);
  const s = Number(sigma);
  if (!Number.isFinite(m) || !Number.isFinite(s) || s <= 0) return null;
  return Math.exp(m + 0.5 * s * s);
}

function meanMixture(components) {
  if (!Array.isArray(components) || components.length === 0) return null;
  let sumW = 0;
  let sum = 0;
  for (const c of components) {
    const w = Number(c.weight);
    const m = Number(c.mean);
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(m)) continue;
    sumW += w;
    sum += w * m;
  }
  if (sumW <= 0) return null;
  return sum / sumW;
}

// Probabilistic (expected-value) model parameters.
// Defaults are chosen so the expected values match (approximately) the legacy deterministic assumptions.
const DEVELOPED_ASSUMPTIONS = {
  conversions: {
    squareYardsPerAcre: 4840, // 43560 ft^2 / 9
    squareFeetPerAcre: 43560,
    cubicYardsPerAcrePerFoot: 1613.3333333333333, // 43560 ft^2 / 27
  },
  // Model: F_imp ~ Beta(alpha,beta)
  // Default mean=0.75 so that asphalt+concrete removal shares can reproduce legacy 0.50 + 0.25.
  imperviousFraction: {
    distribution: 'Beta',
    alpha: 3,
    beta: 1,
  },
  // Model: S_asph ~ Beta(alpha,beta), S_conc = 1 - S_asph
  // Default mean=2/3 so E[F_imp*S_asph]=0.50 when E[F_imp]=0.75.
  asphaltShareOfImpervious: {
    distribution: 'Beta',
    alpha: 2,
    beta: 1,
  },
  // Model: D_cut is a 2-component lognormal mixture; default mean=0.5 ft.
  earthworkCutDepthFt: {
    distribution: 'MixtureLogNormal',
    components: [
      { weight: 0.8, mean: 0.4, sigma: 0.25 },
      { weight: 0.2, mean: 0.9, sigma: 0.35 },
    ],
  },
  // Optional (not used in current cost calc): thickness distributions for future volume-based removal.
  asphaltThicknessFt: {
    distribution: 'LogNormal',
    mean: 0.25,
    sigma: 0.35,
  },
  concreteThicknessFt: {
    distribution: 'LogNormal',
    mean: 0.5,
    sigma: 0.35,
  },
};

const VEGETATION_ASSUMPTIONS = {
  // Model: tree density per acre N ~ NegBin(...) with mean mu.
  // Default mean matches legacy 50 trees/acre.
  treeDensity: {
    distribution: 'NegBin',
    meanTreesPerAcre: 50,
    dispersionK: 20,
  },
  // Diameter classes; default uses a single priced class aligned to MDOT keys.
  // pi: class share, rho: removal probability, sigma: stump probability given removed tree.
  // multipliers allow mapping unpriced classes to existing priced keys.
  diameterClasses: [
    {
      id: '6to18',
      pi: 1,
      rho: 1,
      sigma: 1,
      treePriceMultiplier: 1,
      stumpPriceMultiplier: 1,
      priceKeys: {
        tree: 'treeRemoval6to18',
        stump: 'stumpRemoval6to18',
      },
    },
  ],
};

function buildDevelopedExpectedValues() {
  const fImpMean = meanBeta(DEVELOPED_ASSUMPTIONS.imperviousFraction.alpha, DEVELOPED_ASSUMPTIONS.imperviousFraction.beta);
  const sAsphMean = meanBeta(
    DEVELOPED_ASSUMPTIONS.asphaltShareOfImpervious.alpha,
    DEVELOPED_ASSUMPTIONS.asphaltShareOfImpervious.beta
  );

  const components = (DEVELOPED_ASSUMPTIONS.earthworkCutDepthFt.components || []).map((c) => {
    const sigma = Number(c.sigma);
    const mu = lognormalMuForMean(c.mean, sigma);
    const mean = mu == null ? null : meanLogNormal(mu, sigma);
    return {
      weight: c.weight,
      sigma,
      mu,
      mean,
    };
  });
  const dCutMean = meanMixture(components);

  return {
    fImpMean: Number.isFinite(fImpMean) ? fImpMean : null,
    sAsphMean: Number.isFinite(sAsphMean) ? sAsphMean : null,
    sConcMean: Number.isFinite(sAsphMean) ? 1 - sAsphMean : null,
    dCutMean: Number.isFinite(dCutMean) ? dCutMean : null,
    earthworkCutDepthComponents: components,
  };
}

function buildVegetationExpectedValues() {
  const meanTrees = Number(VEGETATION_ASSUMPTIONS.treeDensity?.meanTreesPerAcre);
  const classes = Array.isArray(VEGETATION_ASSUMPTIONS.diameterClasses)
    ? VEGETATION_ASSUMPTIONS.diameterClasses
    : [];

  let sumTreeFactor = 0;
  let sumStumpFactor = 0;
  for (const c of classes) {
    const pi = Number(c.pi);
    const rho = Number(c.rho);
    const sigma = Number(c.sigma);
    const mTree = Number(c.treePriceMultiplier ?? 1);
    const mStump = Number(c.stumpPriceMultiplier ?? 1);
    if (!Number.isFinite(pi) || !Number.isFinite(rho) || pi < 0 || rho < 0) continue;
    const treeTerm = pi * rho * (Number.isFinite(mTree) ? mTree : 1);
    const stumpTerm = pi * rho * (Number.isFinite(sigma) ? sigma : 1) * (Number.isFinite(mStump) ? mStump : 1);
    sumTreeFactor += treeTerm;
    sumStumpFactor += stumpTerm;
  }

  return {
    meanTreesPerAcre: Number.isFinite(meanTrees) ? meanTrees : null,
    expectedTreesRemovedPerAcre:
      Number.isFinite(meanTrees) && meanTrees >= 0 ? meanTrees * sumTreeFactor : null,
    expectedStumpsRemovedPerAcre:
      Number.isFinite(meanTrees) && meanTrees >= 0 ? meanTrees * sumStumpFactor : null,
  };
}

function buildNlcdClassBreakdown(valueCounts) {
  const totalCells = valueCounts.reduce((sum, r) => sum + Number(r.cells || 0), 0);
  const classes = valueCounts
    .map((r) => {
      const value = Number(r.value);
      const cells = Number(r.cells || 0);
      const info = NLCD_CLASS_INFO[value] || { name: `Class ${value}`, group: 'unknown' };
      const percent = totalCells > 0 ? (cells / totalCells) * 100 : null;

      return {
        value,
        name: info.name,
        group: info.group,
        cells,
        percent,
      };
    })
    .sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1));

  const waterCells = valueCounts
    .filter((r) => Number(r.value) === 11)
    .reduce((sum, r) => sum + Number(r.cells || 0), 0);
  const waterPercent = totalCells > 0 ? (waterCells / totalCells) * 100 : null;

  return {
    totalCells,
    waterCells,
    waterPercent,
    classes,
  };
}

function estimateSitePrepCostUsd({ areaAcres, classBreakdown, pricingSnapshot }) {
  if (!areaAcres || areaAcres <= 0 || !classBreakdown) {
    return {
      estimatedTotalUsd: null,
      estimatedPerAcreUsd: null,
      breakdown: [],
      equations: {
        note: 'No equations: missing/zero areaAcres or classBreakdown.',
      },
    };
  }

  const msuRates = pricingSnapshot?.sources?.msu?.extractedRatesUsdPerAcre || null;
  const mdotItems = pricingSnapshot?.sources?.mdot?.extractedItems || null;
  if (!msuRates && !mdotItems) {
    const err = new Error('Missing live pricing rates in pricingSnapshot (MSU and MDOT sources unavailable).');
    err.statusCode = 503;
    throw err;
  }

  const byGroup = new Map();
  for (const c of classBreakdown.classes) {
    if (c.percent == null) continue;
    const prev = byGroup.get(c.group) || 0;
    byGroup.set(c.group, prev + c.percent);
  }

  const breakdown = Array.from(byGroup.entries())
    .map(([group, percent]) => {
      const model = SITE_PREP_MODEL_BY_GROUP[group] || SITE_PREP_MODEL_BY_GROUP.unknown;
      const operation = model.operation;
      const groupAreaAcres = (percent / 100) * areaAcres;

      // Open water: show a $0 site-prep estimate (non-buildable in practice, but avoids "Unknown" for top class).
      if (operation === 'zero') {
        return {
          group,
          percent,
          areaAcres: groupAreaAcres,
          operation,
          usdPerAcre: 0,
          costUsd: 0,
          priced: true,
          basis: 'Open water (NLCD 11): no site-prep estimate applied',
        };
      }

      // Developed land: MDOT weighted-average bid items + probabilistic (expected-value) quantity takeoff.
      if (operation === 'mdotDeveloped') {
        const items = [];

        const add = ({ key, unit, unitPriceUsd, quantity, description, itemId, basis }) => {
          if (!Number.isFinite(unitPriceUsd) || !Number.isFinite(quantity) || quantity <= 0) return;
          items.push({
            key,
            itemId: itemId || null,
            description: description || null,
            unit,
            unitPriceUsd,
            quantity,
            costUsd: unitPriceUsd * quantity,
            basis,
          });
        };

        const clearing = mdotItems?.clearingAndGrubbing;
        if (clearing?.avgAwardPriceUsd && String(clearing.unit || '').toLowerCase() === 'acr') {
          add({
            key: 'clearingAndGrubbing',
            unit: 'Acr',
            unitPriceUsd: Number(clearing.avgAwardPriceUsd),
            quantity: groupAreaAcres,
            description: clearing.description,
            itemId: clearing.itemId,
            basis: 'MDOT weighted average item prices',
          });
        }

        const pavement = mdotItems?.pavementRemoval;
        if (pavement?.avgAwardPriceUsd && String(pavement.unit || '').toLowerCase() === 'syd') {
          const ev = buildDevelopedExpectedValues();
          const syd =
            groupAreaAcres *
            DEVELOPED_ASSUMPTIONS.conversions.squareYardsPerAcre *
            (ev.fImpMean ?? 0) *
            (ev.sAsphMean ?? 0);
          add({
            key: 'pavementRemoval',
            unit: 'Syd',
            unitPriceUsd: Number(pavement.avgAwardPriceUsd),
            quantity: syd,
            description: pavement.description,
            itemId: pavement.itemId,
            basis: `Expected pavement removal share: E[F_imp]*E[S_asph] with E[F_imp]=${
              ev.fImpMean == null ? 'null' : ev.fImpMean.toFixed(3)
            }, E[S_asph]=${ev.sAsphMean == null ? 'null' : ev.sAsphMean.toFixed(3)}`,
          });
        }

        // Concrete removal: choose Syd if available, else fall back to Sft to avoid double-counting.
        const evForConcrete = buildDevelopedExpectedValues();
        const concreteSyd = mdotItems?.concreteRemovalSyd;
        const concreteSft = mdotItems?.concreteRemovalSft;
        if (concreteSyd?.avgAwardPriceUsd && String(concreteSyd.unit || '').toLowerCase() === 'syd') {
          const syd =
            groupAreaAcres *
            DEVELOPED_ASSUMPTIONS.conversions.squareYardsPerAcre *
            (evForConcrete.fImpMean ?? 0) *
            (evForConcrete.sConcMean ?? 0);
          add({
            key: 'concreteRemovalSyd',
            unit: 'Syd',
            unitPriceUsd: Number(concreteSyd.avgAwardPriceUsd),
            quantity: syd,
            description: concreteSyd.description,
            itemId: concreteSyd.itemId,
            basis: `Expected concrete removal share: E[F_imp]*E[S_conc] with E[F_imp]=${
              evForConcrete.fImpMean == null ? 'null' : evForConcrete.fImpMean.toFixed(3)
            }, E[S_conc]=${evForConcrete.sConcMean == null ? 'null' : evForConcrete.sConcMean.toFixed(3)}`,
          });
        } else if (concreteSft?.avgAwardPriceUsd && String(concreteSft.unit || '').toLowerCase() === 'sft') {
          const sft =
            groupAreaAcres *
            DEVELOPED_ASSUMPTIONS.conversions.squareFeetPerAcre *
            (evForConcrete.fImpMean ?? 0) *
            (evForConcrete.sConcMean ?? 0);
          add({
            key: 'concreteRemovalSft',
            unit: 'Sft',
            unitPriceUsd: Number(concreteSft.avgAwardPriceUsd),
            quantity: sft,
            description: concreteSft.description,
            itemId: concreteSft.itemId,
            basis: `Expected concrete removal share: E[F_imp]*E[S_conc] with E[F_imp]=${
              evForConcrete.fImpMean == null ? 'null' : evForConcrete.fImpMean.toFixed(3)
            }, E[S_conc]=${evForConcrete.sConcMean == null ? 'null' : evForConcrete.sConcMean.toFixed(3)}`,
          });
        }

        const earth = mdotItems?.earthExcavation;
        if (earth?.avgAwardPriceUsd && String(earth.unit || '').toLowerCase() === 'cyd') {
          const ev = buildDevelopedExpectedValues();
          const cyd =
            groupAreaAcres *
            DEVELOPED_ASSUMPTIONS.conversions.cubicYardsPerAcrePerFoot *
            (ev.dCutMean ?? 0);
          add({
            key: 'earthExcavation',
            unit: 'Cyd',
            unitPriceUsd: Number(earth.avgAwardPriceUsd),
            quantity: cyd,
            description: earth.description,
            itemId: earth.itemId,
            basis: `Expected cut depth: E[D_cut]=${ev.dCutMean == null ? 'null' : ev.dCutMean.toFixed(3)} ft (mixture model)`,
          });
        }

        const priced = items.length > 0;
        const costUsd = priced ? items.reduce((sum, i) => sum + (i.costUsd || 0), 0) : null;

        return {
          group,
          percent,
          areaAcres: groupAreaAcres,
          operation,
          items,
          costUsd,
          priced,
          ...(priced
            ? { assumptions: DEVELOPED_ASSUMPTIONS }
            : {
                reason: mdotItems
                  ? 'No matching MDOT developed-land items found in pricing snapshot.'
                  : 'MDOT item prices unavailable in pricing snapshot.',
              }),
        };
      }

      // Forest + wetlands: MDOT vegetation items (tree/stump removal) with probabilistic (expected-value) density model.
      if (operation === 'mdotVegetation') {
        const items = [];

        const add = ({ key, unit, unitPriceUsd, quantity, description, itemId, basis }) => {
          if (!Number.isFinite(unitPriceUsd) || !Number.isFinite(quantity) || quantity <= 0) return;
          items.push({
            key,
            itemId: itemId || null,
            description: description || null,
            unit,
            unitPriceUsd,
            quantity,
            costUsd: unitPriceUsd * quantity,
            basis,
          });
        };

        const tree = mdotItems?.treeRemoval6to18;
        const stump = mdotItems?.stumpRemoval6to18;
        const vEv = buildVegetationExpectedValues();
        const expectedTrees = groupAreaAcres * (vEv.expectedTreesRemovedPerAcre ?? 0);
        const expectedStumps = groupAreaAcres * (vEv.expectedStumpsRemovedPerAcre ?? 0);

        if (tree?.avgAwardPriceUsd && String(tree.unit || '').toLowerCase() === 'ea') {
          add({
            key: 'treeRemoval6to18',
            unit: 'Ea',
            unitPriceUsd: Number(tree.avgAwardPriceUsd),
            quantity: expectedTrees,
            description: tree.description,
            itemId: tree.itemId,
            basis: `Expected trees removed: E[N]*Σ(pi*rho*m_tree) with E[N]=${
              vEv.meanTreesPerAcre == null ? 'null' : vEv.meanTreesPerAcre
            }, E[trees/acre]=${
              vEv.expectedTreesRemovedPerAcre == null ? 'null' : vEv.expectedTreesRemovedPerAcre.toFixed(2)
            }`,
          });
        }

        if (stump?.avgAwardPriceUsd && String(stump.unit || '').toLowerCase() === 'ea') {
          add({
            key: 'stumpRemoval6to18',
            unit: 'Ea',
            unitPriceUsd: Number(stump.avgAwardPriceUsd),
            quantity: expectedStumps,
            description: stump.description,
            itemId: stump.itemId,
            basis: `Expected stumps removed: E[N]*Σ(pi*rho*sigma*m_stump) with E[stumps/acre]=${
              vEv.expectedStumpsRemovedPerAcre == null ? 'null' : vEv.expectedStumpsRemovedPerAcre.toFixed(2)
            }`,
          });
        }

        const priced = items.length > 0;
        const costUsd = priced ? items.reduce((sum, i) => sum + (i.costUsd || 0), 0) : null;

        return {
          group,
          percent,
          areaAcres: groupAreaAcres,
          operation,
          items,
          costUsd,
          priced,
          ...(priced
            ? { assumptions: VEGETATION_ASSUMPTIONS }
            : {
                reason: mdotItems
                  ? 'No matching MDOT vegetation items found in pricing snapshot.'
                  : 'MDOT item prices unavailable in pricing snapshot.',
              }),
        };
      }

      // MSU per-acre operation totals (non-developed landcover proxies)
      if (operation && msuRates && Object.prototype.hasOwnProperty.call(msuRates, operation)) {
        const usdPerAcre = msuRates[operation];
        const canPrice = Number.isFinite(usdPerAcre);
        const costUsd = canPrice ? groupAreaAcres * usdPerAcre : null;

        return {
          group,
          percent,
          areaAcres: groupAreaAcres,
          operation,
          usdPerAcre,
          costUsd,
          priced: Boolean(canPrice),
          ...(canPrice ? {} : { reason: `No MSU per-acre rate found for operation '${operation}'.` }),
        };
      }

      return {
        group,
        percent,
        areaAcres: groupAreaAcres,
        operation,
        usdPerAcre: null,
        costUsd: null,
        priced: false,
        reason: 'No pricing model available for this landcover group.',
      };
    })
    .sort((a, b) => (b.costUsd ?? -1) - (a.costUsd ?? -1));

  const pricedAreaAcres = breakdown.reduce((sum, b) => sum + (b.priced ? b.areaAcres : 0), 0);
  const estimatedTotalUsd =
    pricedAreaAcres > 0 ? breakdown.reduce((sum, b) => sum + (b.costUsd || 0), 0) : null;
  const estimatedPerAcreUsd = pricedAreaAcres > 0 ? estimatedTotalUsd / pricedAreaAcres : null;

  const developedEv = buildDevelopedExpectedValues();
  const vegetationEv = buildVegetationExpectedValues();

  const equations = {
    units: {
      area: 'acres',
      currency: 'USD',
      pavementRemovalUnit: 'Syd',
      concreteRemovalSydUnit: 'Syd',
      concreteRemovalSftUnit: 'Sft',
      earthExcavationUnit: 'Cyd',
      vegetationUnit: 'Ea',
    },
    constants: {
      developedAssumptions: {
        ...DEVELOPED_ASSUMPTIONS,
        expectedValues: {
          imperviousFractionMean: developedEv.fImpMean,
          asphaltShareMean: developedEv.sAsphMean,
          concreteShareMean: developedEv.sConcMean,
          earthworkCutDepthFtMean: developedEv.dCutMean,
        },
      },
      vegetationAssumptions: {
        ...VEGETATION_ASSUMPTIONS,
        expectedValues: {
          meanTreesPerAcre: vegetationEv.meanTreesPerAcre,
          expectedTreesRemovedPerAcre: vegetationEv.expectedTreesRemovedPerAcre,
          expectedStumpsRemovedPerAcre: vegetationEv.expectedStumpsRemovedPerAcre,
        },
      },
    },
    modelByGroup: SITE_PREP_MODEL_BY_GROUP,
    equations: [
      {
        id: 'groupPercent',
        equation: 'groupPercent[group] = Σ(percentOfFarm for NLCD classes in the same group)',
        notes: 'Groups come from NLCD class mapping (e.g., forest, developed, ag). Percents are in % of NLCD cells within the farm polygon.',
      },
      {
        id: 'groupAreaAcres',
        equation: 'groupAreaAcres[group] = areaAcres * (groupPercent[group] / 100)',
      },
      {
        id: 'msuCostUsd',
        appliesTo: 'Non-developed groups priced via MSU per-acre operation totals',
        equation: 'costUsd[group] = groupAreaAcres[group] * msuUsdPerAcre[operation]',
        notes: "operation is chosen via SITE_PREP_MODEL_BY_GROUP and msuUsdPerAcre comes from pricingSnapshot.sources.msu.extractedRatesUsdPerAcre.",
      },
      {
        id: 'mdotDevelopedItems',
        appliesTo: 'Developed group (mdotDeveloped): probabilistic expected-value takeoff',
        equation: 'costUsd[group] = Σ(unitPriceUsd[item] * E[quantity[item]]) over available MDOT items',
        notes:
          'unitPriceUsd comes from pricingSnapshot.sources.mdot.extractedItems.*.avgAwardPriceUsd. Quantities are computed using expected values (independence approximation for products). Concrete removal uses Syd if available, else Sft (to avoid double-counting).',
        randomVariables: [
          {
            name: 'F_imp',
            definition: 'Impervious fraction on developed land',
            distribution: 'Beta(alpha_imp, beta_imp)',
          },
          {
            name: 'S_asph',
            definition: 'Asphalt share of impervious area',
            distribution: 'Beta(alpha_a, beta_a)',
          },
          {
            name: 'S_conc',
            definition: 'Concrete share of impervious area',
            distribution: '1 - S_asph',
          },
          {
            name: 'D_cut',
            definition: 'Earthwork cut depth across developed area (ft)',
            distribution: 'Mixture of LogNormal components',
          },
        ],
        quantities: [
          {
            item: 'clearingAndGrubbing',
            equation: 'Q_C&G = groupAreaAcres',
            unit: 'Acr',
          },
          {
            item: 'pavementRemoval',
            equation: 'E[Q_pav,Syd] = groupAreaAcres * 4840 * E[F_imp] * E[S_asph]',
            unit: 'Syd',
          },
          {
            item: 'concreteRemovalSyd',
            equation: 'E[Q_conc,Syd] = groupAreaAcres * 4840 * E[F_imp] * E[S_conc]',
            unit: 'Syd',
          },
          {
            item: 'concreteRemovalSft',
            equation: 'E[Q_conc,Sft] = groupAreaAcres * 43560 * E[F_imp] * E[S_conc]',
            unit: 'Sft',
          },
          {
            item: 'earthExcavation',
            equation: 'E[Q_earth,Cyd] = groupAreaAcres * 1613.333... * E[D_cut]',
            unit: 'Cyd',
          },
        ],
      },
      {
        id: 'mdotVegetationItems',
        appliesTo: 'Forest + wetlands groups (mdotVegetation): probabilistic expected-value tree/stump takeoff',
        equation:
          'E[costUsd[group]] = groupAreaAcres * Σ_c ( u_tree,c * E[N]*pi_c*rho_c + u_stump,c * E[N]*pi_c*rho_c*sigma_c )',
        notes:
          'Unit prices come from pricingSnapshot.sources.mdot.extractedItems.treeRemoval6to18 / stumpRemoval6to18 (Avg Award Price). If additional diameter classes are used without explicit MDOT prices, map them via multipliers to the existing keys.',
        randomVariables: [
          {
            name: 'N',
            definition: 'Tree count per acre',
            distribution: 'NegBin(meanTreesPerAcre, dispersionK) (parameterized by mean)',
          },
          {
            name: 'Class mixture',
            definition: 'Diameter class allocation, removal probability, stump probability',
            distribution: 'Multinomial + Binomial thinning by class',
          },
        ],
      },
      {
        id: 'pricedAreaAcres',
        equation: 'pricedAreaAcres = Σ(groupAreaAcres for groups with priced=true)',
        notes: 'Open water counts as priced with $0; groups with missing prices do not contribute.',
      },
      {
        id: 'estimatedTotalUsd',
        equation: 'estimatedTotalUsd = Σ(costUsd[group]) (only if pricedAreaAcres > 0; else null)',
      },
      {
        id: 'estimatedPerAcreUsd',
        equation: 'estimatedPerAcreUsd = estimatedTotalUsd / pricedAreaAcres (only if pricedAreaAcres > 0; else null)',
      },
    ],
  };

  return {
    estimatedTotalUsd,
    estimatedPerAcreUsd,
    breakdown,
    equations,
    coverage: {
      pricedAreaAcres,
      totalAreaAcres: areaAcres,
      pricedPercent: areaAcres > 0 ? (pricedAreaAcres / areaAcres) * 100 : null,
    },
    pricingSnapshotMeta: {
      pricingSnapshotRetrievedAt: pricingSnapshot?.retrievedAt || pricingSnapshot?.retrieved_at || null,
      sources: pricingSnapshot?.sources || null,
    },
  };
}

function isFullyWaterFromNlcd(classBreakdown) {
  if (!classBreakdown || !Number.isFinite(classBreakdown.totalCells) || classBreakdown.totalCells <= 0) {
    return false;
  }
  return classBreakdown.waterCells === classBreakdown.totalCells;
}

module.exports = {
  NLCD_CLASS_INFO,
  buildNlcdClassBreakdown,
  estimateSitePrepCostUsd,
  isFullyWaterFromNlcd,
  SITE_PREP_MODEL_BY_GROUP,
};
