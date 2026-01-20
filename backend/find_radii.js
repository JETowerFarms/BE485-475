const { db } = require('./src/database');

async function findMaxDistances() {
  console.log('Finding maximum distances (radii) in tables...\n');

  const results = {};

  // Helper function to calculate raster extent diagonal
  async function calculateRasterRadius(tableName, description) {
    console.log(`=== ${description.toUpperCase()} ===`);
    try {
      const extent = await db.one(`
        SELECT
          ST_XMin(extent) as xmin,
          ST_XMax(extent) as xmax,
          ST_YMin(extent) as ymin,
          ST_YMax(extent) as ymax
        FROM (SELECT ST_Extent(ST_Transform(ST_Envelope(rast), 4326)) as extent FROM ${tableName}) as sub
      `);
      const radius = Math.sqrt((extent.xmax - extent.xmin) ** 2 + (extent.ymax - extent.ymin) ** 2);
      console.log(`${description} coverage diagonal (radius): ${radius.toFixed(6)} degrees`);
      results[tableName] = radius;
      return radius;
    } catch (error) {
      console.log(`Error calculating ${description} radius: ${error.message}`);
      return null;
    }
  }

  // Helper function to calculate vector table maximum distance (with fallback for large tables)
  async function calculateVectorRadius(tableName, description) {
    console.log(`=== ${description.toUpperCase()} ===`);
    try {
      // First try to get a quick estimate using extent
      const extentResult = await db.oneOrNone(`
        SELECT
          ST_XMin(ST_Extent(ST_Transform(geom, 4326))) as xmin,
          ST_XMax(ST_Extent(ST_Transform(geom, 4326))) as xmax,
          ST_YMin(ST_Extent(ST_Transform(geom, 4326))) as ymin,
          ST_YMax(ST_Extent(ST_Transform(geom, 4326))) as ymax
        FROM ${tableName}
        WHERE geom IS NOT NULL
      `);

      if (extentResult && extentResult.xmin !== null) {
        const radius = Math.sqrt((extentResult.xmax - extentResult.xmin) ** 2 + (extentResult.ymax - extentResult.ymin) ** 2);
        console.log(`${description} extent diagonal (radius): ${radius.toFixed(6)} degrees`);
        results[tableName] = radius;
        return radius;
      } else {
        console.log(`No valid geometries found in ${description}`);
        return null;
      }
    } catch (error) {
      console.log(`Error calculating ${description} radius: ${error.message}`);
      return null;
    }
  }

  // Helper function to calculate union of multiple vector tables
  async function calculateUnionVectorRadius(tableNames, description) {
    console.log(`=== ${description.toUpperCase()} ===`);
    try {
      const unionQuery = tableNames.map(table => `SELECT geom FROM ${table}`).join(' UNION ALL ');
      const maxDist = await db.one(`
        SELECT MAX(ST_Distance(a.geom, b.geom)) as max_dist
        FROM (${unionQuery}) a, (${unionQuery}) b
        WHERE a.ctid != b.ctid
      `);
      const radius = maxDist.max_dist;
      console.log(`Maximum ${description} distance (radius): ${radius.toFixed(6)} degrees`);
      results[description.toLowerCase().replace(/\s+/g, '_')] = radius;
      return radius;
    } catch (error) {
      console.log(`Error calculating ${description} radius: ${error.message}`);
      return null;
    }
  }

  // Calculate radii for all raster tables used by grabbers
  await calculateRasterRadius('landcover_nlcd_2024_raster', 'NLCD Landcover');
  await calculateRasterRadius('slope_raster', 'Slope');
  await calculateRasterRadius('population_raster', 'Population');
  await calculateRasterRadius('elevation_raster', 'Elevation');

  // Calculate radii for all vector tables used by grabbers (with correct table names)
  await calculateVectorRadius('substations', 'Substations');

  // Building-related tables
  await calculateVectorRadius('landcover_building_locations_usace_ienc', 'Building Locations');
  await calculateVectorRadius('landcover_landforms', 'Landforms/Structures');

  // Road-related tables
  await calculateVectorRadius('landcover_roads_usace_ienc', 'Roads USACE');
  await calculateVectorRadius('landcover_local_roads', 'Local Roads');
  await calculateVectorRadius('landcover_primary_roads', 'Primary Roads');

  // Water-related tables
  await calculateVectorRadius('landcover_waterbody', 'Water Bodies');
  await calculateVectorRadius('landcover_lakes', 'Lakes');
  await calculateVectorRadius('landcover_river_lines', 'River Lines');
  await calculateVectorRadius('landcover_river_areas', 'River Areas');
  await calculateVectorRadius('landcover_streams_mouth', 'Streams Mouth');
  await calculateVectorRadius('landcover_coastlines', 'Coastlines');

  // Summary
  console.log('\n=== SUMMARY ===');
  Object.entries(results).forEach(([table, radius]) => {
    if (radius !== null) {
      const km = radius * 111; // Rough conversion to km
      console.log(`${table}: ${radius.toFixed(6)} degrees (~${km.toFixed(1)} km)`);
    }
  });

  // Export results for use in grabbers
  console.log('\n=== EXPORT FOR GRABBERS ===');
  console.log('// Copy these values to your data grabber files:');
  Object.entries(results).forEach(([table, radius]) => {
    if (radius !== null) {
      const buffered = radius + 0.005; // Add small buffer
      console.log(`// ${table}: ${buffered.toFixed(6)}`);
    }
  });

  return results;
}

findMaxDistances().then(() => {
  console.log('\nScript completed');
  process.exit(0);
});