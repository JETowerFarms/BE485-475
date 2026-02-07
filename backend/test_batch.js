const { querySolarDataForPoints } = require('./src/utils/solarDataGrabber');

async function testBatchQuery() {
  try {
    console.log('Testing batch solar data query...');

    // Test with a few sample points (Michigan coordinates)
    const testPoints = [
      [-83.0458, 42.3314], // Detroit area
      [-84.3863, 43.6150], // Lansing area
      [-85.6681, 44.3148]  // Grand Rapids area
    ];

    console.log(`Querying ${testPoints.length} points...`);
    const results = await querySolarDataForPoints(testPoints);

    console.log('Results:');
    results.forEach((result, index) => {
      console.log(`Point ${index + 1} (${result.lng}, ${result.lat}):`);
      console.log(`  NLCD: ${result.nlcd_value}`);
      console.log(`  Slope: ${result.slope_elevation}`);
      console.log(`  Population: ${result.population_density}`);
      console.log(`  Substation distance: ${result.sub_distance}`);
      console.log('');
    });

    console.log('Batch query test completed successfully!');

  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

testBatchQuery().then(() => process.exit(0));