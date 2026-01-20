// JavaScript implementation of solar suitability scoring functions
// Based on the SQL functions in the database

function scoreLandcover(nlcdCode) {
  if (nlcdCode === null || nlcdCode === undefined) return null;

  // EGLE solar landcover scoring
  if ([81, 82].includes(nlcdCode)) return 100;  // Pasture/Hay, Cultivated Crops
  if (nlcdCode === 71) return 90;              // Grassland/Herbaceous
  if ([52, 31].includes(nlcdCode)) return 80;  // Shrub/Scrub, Barren Land
  if ([41, 42, 43].includes(nlcdCode)) return 60; // Deciduous/Mixed/Evergreen Forest
  if ([21, 22, 23, 24].includes(nlcdCode)) return 40; // Developed
  if ([11, 12, 90, 95].includes(nlcdCode)) return 20; // Water, wetlands
  return 50; // Default/unknown
}

function scoreSlope(slopeDegrees) {
  if (slopeDegrees === null || slopeDegrees === undefined) return null;

  if (slopeDegrees <= 1) return 100;
  if (slopeDegrees <= 3) return 90;
  if (slopeDegrees <= 5) return 80;
  if (slopeDegrees <= 10) return 60;
  if (slopeDegrees <= 15) return 40;
  if (slopeDegrees <= 20) return 20;
  return 10;
}

function scorePopulation(popDensity) {
  if (popDensity === null || popDensity === undefined) return null;

  // Population per square km
  if (popDensity <= 10) return 100;
  if (popDensity <= 50) return 90;
  if (popDensity <= 100) return 80;
  if (popDensity <= 500) return 60;
  if (popDensity <= 1000) return 40;
  if (popDensity <= 5000) return 20;
  return 10;
}

function scoreTransmissionDistance(distanceMeters) {
  if (distanceMeters === null || distanceMeters === undefined) return null;

  // Distance in meters
  if (distanceMeters <= 1000) return 100;  // Within 1km
  if (distanceMeters <= 5000) return 90;   // Within 5km
  if (distanceMeters <= 10000) return 80;  // Within 10km
  if (distanceMeters <= 20000) return 60;  // Within 20km
  if (distanceMeters <= 50000) return 40;  // Within 50km
  return 20;  // Over 50km
}

function calculateOverallScore(landcoverScore, slopeScore, populationScore, transmissionScore) {
  if (landcoverScore === null || slopeScore === null ||
      populationScore === null || transmissionScore === null) {
    return null;
  }

  return (0.4 * landcoverScore) + (0.3 * slopeScore) + (0.2 * populationScore) + (0.1 * transmissionScore);
}

// Test data from the coordinates we queried
const testPoints = [
  {
    coords: [42.66988, -83.371120],
    landcover: 23,
    slope: 1,
    population: 444.6648864746094,
    transmission: 2015.4212483606514
  },
  {
    coords: [42.670101, -83.369972],
    landcover: 22,
    slope: 1,
    population: 444.6648864746094,
    transmission: 1918.7970026588616
  },
  {
    coords: [42.668736, -83.370723],
    landcover: 22,
    slope: 2,
    population: 444.6648864746094,
    transmission: 2014.7314050675784
  },
  {
    coords: [42.669139, -83.369221],
    landcover: 21,
    slope: 2,
    population: 444.6648864746094,
    transmission: 1884.7413680911043
  }
];

console.log('=== SOLAR SUITABILITY SCORE CALCULATIONS ===\n');

testPoints.forEach((point, index) => {
  console.log(`Point ${index + 1}: (${point.coords[0]}, ${point.coords[1]})`);
  console.log(`Raw Data: NLCD=${point.landcover}, Slope=${point.slope}°, Pop=${point.population.toFixed(2)}/km², Dist=${point.transmission.toFixed(2)}m`);

  const landcoverScore = scoreLandcover(point.landcover);
  const slopeScore = scoreSlope(point.slope);
  const populationScore = scorePopulation(point.population);
  const transmissionScore = scoreTransmissionDistance(point.transmission);
  const overallScore = calculateOverallScore(landcoverScore, slopeScore, populationScore, transmissionScore);

  console.log(`Scores: Landcover=${landcoverScore}, Slope=${slopeScore}, Population=${populationScore}, Transmission=${transmissionScore}`);
  console.log(`Overall Score: ${overallScore ? overallScore.toFixed(2) : 'NULL'}`);
  console.log('---\n');
});