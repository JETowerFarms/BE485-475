/**
 * Convert Michigan MCD shapefile to complete GeoJSON
 * This script reads the Census Bureau TIGER/Line shapefile and outputs
 * a full-detail GeoJSON file for all Michigan Minor Civil Divisions
 */

const shapefile = require('shapefile');
const fs = require('fs');
const path = require('path');

// Michigan county FIPS codes to names mapping
const COUNTY_FIPS = {
  '001': 'Alcona', '003': 'Alger', '005': 'Allegan', '007': 'Alpena',
  '009': 'Antrim', '011': 'Arenac', '013': 'Baraga', '015': 'Barry',
  '017': 'Bay', '019': 'Benzie', '021': 'Berrien', '023': 'Branch',
  '025': 'Calhoun', '027': 'Cass', '029': 'Charlevoix', '031': 'Cheboygan',
  '033': 'Chippewa', '035': 'Clare', '037': 'Clinton', '039': 'Crawford',
  '041': 'Delta', '043': 'Dickinson', '045': 'Eaton', '047': 'Emmet',
  '049': 'Genesee', '051': 'Gladwin', '053': 'Gogebic', '055': 'Grand Traverse',
  '057': 'Gratiot', '059': 'Hillsdale', '061': 'Houghton', '063': 'Huron',
  '065': 'Ingham', '067': 'Ionia', '069': 'Iosco', '071': 'Iron',
  '073': 'Isabella', '075': 'Jackson', '077': 'Kalamazoo', '079': 'Kalkaska',
  '081': 'Kent', '083': 'Keweenaw', '085': 'Lake', '087': 'Lapeer',
  '089': 'Leelanau', '091': 'Lenawee', '093': 'Livingston', '095': 'Luce',
  '097': 'Mackinac', '099': 'Macomb', '101': 'Manistee', '103': 'Marquette',
  '105': 'Mason', '107': 'Mecosta', '109': 'Menominee', '111': 'Midland',
  '113': 'Missaukee', '115': 'Monroe', '117': 'Montcalm', '119': 'Montmorency',
  '121': 'Muskegon', '123': 'Newaygo', '125': 'Oakland', '127': 'Oceana',
  '129': 'Ogemaw', '131': 'Ontonagon', '133': 'Osceola', '135': 'Oscoda',
  '137': 'Otsego', '139': 'Ottawa', '141': 'Presque Isle', '143': 'Roscommon',
  '145': 'Saginaw', '147': 'St. Clair', '149': 'St. Joseph', '151': 'Sanilac',
  '153': 'Schoolcraft', '155': 'Shiawassee', '157': 'Tuscola', '159': 'Van Buren',
  '161': 'Washtenaw', '163': 'Wayne', '165': 'Wexford'
};

async function convertShapefile() {
  const shpPath = path.join(__dirname, 'mcd_shp', 'tl_2023_26_cousub.shp');
  const dbfPath = path.join(__dirname, 'mcd_shp', 'tl_2023_26_cousub.dbf');
  
  console.log('Reading shapefile from:', shpPath);
  
  const features = [];
  const countyStats = {};
  
  const source = await shapefile.open(shpPath, dbfPath);
  
  let result = await source.read();
  while (!result.done) {
    const feature = result.value;
    
    if (feature && feature.properties) {
      // Extract county FIPS code (positions 2-4 of GEOID)
      const geoid = feature.properties.GEOID || '';
      const countyFips = geoid.substring(2, 5);
      const countyName = COUNTY_FIPS[countyFips] || 'Unknown';
      
      // Calculate bounding box for this feature
      let minLng = Infinity, maxLng = -Infinity;
      let minLat = Infinity, maxLat = -Infinity;
      
      const processCoords = (coords) => {
        if (typeof coords[0] === 'number') {
          // Single point [lng, lat]
          minLng = Math.min(minLng, coords[0]);
          maxLng = Math.max(maxLng, coords[0]);
          minLat = Math.min(minLat, coords[1]);
          maxLat = Math.max(maxLat, coords[1]);
        } else {
          // Array of coords
          coords.forEach(processCoords);
        }
      };
      
      if (feature.geometry && feature.geometry.coordinates) {
        processCoords(feature.geometry.coordinates);
      }
      
      // Build the processed feature with full geometry (no simplification)
      const processedFeature = {
        type: 'Feature',
        properties: {
          geoid: feature.properties.GEOID,
          name: feature.properties.NAME,
          namelsad: feature.properties.NAMELSAD,
          county: countyName,
          countyFips: countyFips,
          lsad: feature.properties.LSAD,
          aland: feature.properties.ALAND,
          awater: feature.properties.AWATER,
          bbox: {
            minLng, maxLng, minLat, maxLat
          }
        },
        geometry: feature.geometry  // Keep full geometry, no simplification
      };
      
      features.push(processedFeature);
      
      // Track stats
      if (!countyStats[countyName]) {
        countyStats[countyName] = 0;
      }
      countyStats[countyName]++;
    }
    
    result = await source.read();
  }
  
  // Create the GeoJSON
  const geojson = {
    type: 'FeatureCollection',
    features: features
  };
  
  // Write the full GeoJSON file
  const outputPath = path.join(__dirname, 'src', 'data', 'michiganMCDFull.json');
  fs.writeFileSync(outputPath, JSON.stringify(geojson));
  
  console.log('\n=== Conversion Complete ===');
  console.log(`Total features: ${features.length}`);
  console.log(`Total counties: ${Object.keys(countyStats).length}`);
  console.log(`Output file: ${outputPath}`);
  console.log(`File size: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB`);
  
  // Report counties
  console.log('\n=== County Coverage Report ===');
  const sortedCounties = Object.entries(countyStats).sort((a, b) => a[0].localeCompare(b[0]));
  sortedCounties.forEach(([county, count]) => {
    console.log(`  ${county}: ${count} MCDs`);
  });
  
  // Check for missing counties
  const allCountyNames = Object.values(COUNTY_FIPS);
  const foundCounties = Object.keys(countyStats);
  const missingCounties = allCountyNames.filter(c => !foundCounties.includes(c));
  
  if (missingCounties.length > 0) {
    console.log('\n=== Missing Counties ===');
    missingCounties.forEach(c => console.log(`  - ${c}`));
  } else {
    console.log('\n✓ All 83 Michigan counties have MCD data!');
  }
  
  return geojson;
}

convertShapefile().catch(console.error);
