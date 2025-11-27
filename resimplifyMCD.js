/**
 * Re-simplify Michigan MCD data with better tolerance
 * to preserve actual township shapes instead of reducing to bounding boxes
 */

const fs = require('fs');
const path = require('path');

// Read the current simplified data
const inputPath = path.join(__dirname, 'src/data/michiganMCDSimplified.json');
const outputPath = path.join(__dirname, 'src/data/michiganMCDSimplified.json');

// We need to get better source data. For now, let's check what we have
// and see if we can improve it.

// The issue is that the simplification was too aggressive.
// Michigan townships ARE actually quite rectangular (they follow PLSS grid),
// but they should have more points along irregular boundaries like coastlines.

// Let's analyze the current data
const data = require(inputPath);

console.log('Analyzing current MCD data...\n');

// Group by point count
const pointCounts = {};
data.features.forEach(f => {
  let pts;
  if (f.geometry.type === 'Polygon') {
    pts = f.geometry.coordinates[0].length;
  } else if (f.geometry.type === 'MultiPolygon') {
    pts = f.geometry.coordinates.reduce((sum, poly) => sum + poly[0].length, 0);
  }
  pointCounts[pts] = (pointCounts[pts] || 0) + 1;
});

console.log('Point count distribution:');
Object.entries(pointCounts).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).forEach(([pts, count]) => {
  console.log(`  ${pts} points: ${count} features`);
});

// Check some coastal townships that should have irregular shapes
const huronCoastal = ['Fairhaven', 'Caseville', 'Port Austin', 'Rubicon', 'Gore'];
console.log('\nCoastal townships in Huron County:');
huronCoastal.forEach(name => {
  const f = data.features.find(f => f.properties.name === name && f.properties.county === 'Huron');
  if (f) {
    const pts = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0].length : 'multi';
    console.log(`  ${f.properties.namelsad}: ${pts} points`);
  }
});

// The real issue: Michigan townships ARE rectangular in the interior
// But coastal ones should have more detail
// Let's see if we need to re-download the source data

console.log('\nConclusion: The source data may have been simplified at download time.');
console.log('To fix this, we need to:');
console.log('1. Download fresh TIGER/Line MCD shapefiles from Census Bureau');
console.log('2. Convert to GeoJSON with proper simplification');
console.log('3. Or accept that interior townships ARE rectangular (PLSS grid)');
