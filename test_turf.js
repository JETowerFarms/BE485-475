// Test Turf.js imports
const booleanPointInPolygon = require('@turf/boolean-point-in-polygon').default;
const { point, polygon } = require('@turf/helpers');

console.log('booleanPointInPolygon type:', typeof booleanPointInPolygon);
console.log('point type:', typeof point);
console.log('polygon type:', typeof polygon);

// Test basic usage
try {
  const pt = point([-83.98, 43.18]);
  const poly = polygon([[
    [-84.0, 43.0],
    [-83.0, 43.0],
    [-83.0, 44.0],
    [-84.0, 44.0],
    [-84.0, 43.0]
  ]]);
  
  const result = booleanPointInPolygon(pt, poly);
  console.log('Test point in polygon:', result);
  console.log('✓ Turf.js imports working correctly!');
} catch (error) {
  console.error('❌ Error:', error.message);
}
