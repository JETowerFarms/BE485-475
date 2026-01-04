const {
  buildNlcdClassBreakdown,
  estimateSitePrepCostUsd,
  DEVELOPED_ASSUMPTIONS,
  buildDevelopedExpectedValues,
  buildVegetationExpectedValues,
} = require('../src/landcover');

function makePricingSnapshot({ msuRates = {}, mdotItems = {} } = {}) {
  return {
    retrievedAt: '2025-01-01T00:00:00Z',
    sources: {
      msu: {
        extractedRatesUsdPerAcre: msuRates,
      },
      mdot: {
        extractedItems: mdotItems,
      },
    },
  };
}

function findGroup(result, group) {
  return result.breakdown.find((entry) => entry.group === group);
}

function indexItems(items = []) {
  return Object.fromEntries(items.map((item) => [item.key, item]));
}

describe('estimateSitePrepCostUsd equations', () => {
  test('MSU per-acre operations follow area weighting equations', () => {
    const classBreakdown = buildNlcdClassBreakdown([
      { value: 81, cells: 60 }, // ag
      { value: 71, cells: 40 }, // grass
    ]);
    const msuRates = {
      stalkShredder20Ft: 18.4,
      rotaryMowerConditioner12Ft: 12.2,
    };
    const pricingSnapshot = makePricingSnapshot({ msuRates });

    const result = estimateSitePrepCostUsd({
      areaAcres: 100,
      classBreakdown,
      pricingSnapshot,
    });

    const ag = findGroup(result, 'ag');
    const grass = findGroup(result, 'grass');

    expect(ag.areaAcres).toBeCloseTo(60, 6);
    expect(grass.areaAcres).toBeCloseTo(40, 6);
    expect(ag.costUsd).toBeCloseTo(60 * msuRates.stalkShredder20Ft, 6);
    expect(grass.costUsd).toBeCloseTo(40 * msuRates.rotaryMowerConditioner12Ft, 6);
    expect(result.estimatedTotalUsd).toBeCloseTo(60 * msuRates.stalkShredder20Ft + 40 * msuRates.rotaryMowerConditioner12Ft, 6);
    expect(result.estimatedPerAcreUsd).toBeCloseTo(result.estimatedTotalUsd / 100, 6);
  });

  test('MDOT developed item quantities match probabilistic equations', () => {
    const areaAcres = 12;
    const classBreakdown = buildNlcdClassBreakdown([
      { value: 21, cells: 100 },
    ]);

    const mdotItems = {
      clearingAndGrubbing: { avgAwardPriceUsd: 1, unit: 'Acr', description: 'Clearing' },
      pavementRemoval: { avgAwardPriceUsd: 1, unit: 'Syd', description: 'Pavement' },
      concreteRemovalSyd: { avgAwardPriceUsd: 1, unit: 'Syd', description: 'Concrete' },
      concreteRemovalSft: { avgAwardPriceUsd: 1, unit: 'Sft', description: 'Concrete (Sft)' },
      earthExcavation: { avgAwardPriceUsd: 1, unit: 'Cyd', description: 'Earthwork' },
    };
    const pricingSnapshot = makePricingSnapshot({ mdotItems });

    const result = estimateSitePrepCostUsd({ areaAcres, classBreakdown, pricingSnapshot });
    const developed = findGroup(result, 'developed');
    expect(developed.operation).toBe('mdotDeveloped');

    const items = indexItems(developed.items);
    const expected = buildDevelopedExpectedValues();
    const { conversions } = DEVELOPED_ASSUMPTIONS;

    expect(items.clearingAndGrubbing.quantity).toBeCloseTo(areaAcres, 6);
    expect(items.pavementRemoval.quantity).toBeCloseTo(
      areaAcres * conversions.squareYardsPerAcre * (expected.fImpMean || 0) * (expected.sAsphMean || 0),
      6
    );
    expect(items.concreteRemovalSyd.quantity).toBeCloseTo(
      areaAcres * conversions.squareYardsPerAcre * (expected.fImpMean || 0) * (expected.sConcMean || 0),
      6
    );
    expect(items.earthExcavation.quantity).toBeCloseTo(
      areaAcres * conversions.cubicYardsPerAcrePerFoot * (expected.dCutMean || 0),
      6
    );

    const expectedCost = Object.values(items).reduce((sum, item) => sum + item.costUsd, 0);
    expect(developed.costUsd).toBeCloseTo(expectedCost, 6);
  });

  test('MDOT vegetation item quantities follow tree/stump expectations', () => {
    const areaAcres = 20;
    const classBreakdown = buildNlcdClassBreakdown([
      { value: 41, cells: 100 },
    ]);

    const mdotItems = {
      treeRemoval6to18: { avgAwardPriceUsd: 1, unit: 'Ea', description: 'Tree removal' },
      stumpRemoval6to18: { avgAwardPriceUsd: 1, unit: 'Ea', description: 'Stump removal' },
    };
    const pricingSnapshot = makePricingSnapshot({ mdotItems });

    const result = estimateSitePrepCostUsd({ areaAcres, classBreakdown, pricingSnapshot });
    const forest = findGroup(result, 'forest');
    expect(forest.operation).toBe('mdotVegetation');

    const items = indexItems(forest.items);
    const expected = buildVegetationExpectedValues();

    expect(items.treeRemoval6to18.quantity).toBeCloseTo(areaAcres * (expected.expectedTreesRemovedPerAcre || 0), 6);
    expect(items.stumpRemoval6to18.quantity).toBeCloseTo(areaAcres * (expected.expectedStumpsRemovedPerAcre || 0), 6);

    const expectedCost = Object.values(items).reduce((sum, item) => sum + item.costUsd, 0);
    expect(forest.costUsd).toBeCloseTo(expectedCost, 6);
  });
});
