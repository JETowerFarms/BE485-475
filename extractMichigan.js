const fs = require('fs');

// Read the US counties GeoJSON
const data = JSON.parse(fs.readFileSync('us_counties.json', 'utf8'));

// Filter for Michigan counties (STATE = "26")
const michiganCounties = data.features.filter(f => f.properties.STATE === '26');

console.log(`Found ${michiganCounties.length} Michigan counties`);

// Find bounding box of all Michigan counties
let minLng = Infinity, maxLng = -Infinity;
let minLat = Infinity, maxLat = -Infinity;

michiganCounties.forEach(county => {
  const processCoords = (coords) => {
    coords.forEach(ring => {
      ring.forEach(coord => {
        if (Array.isArray(coord[0])) {
          // MultiPolygon nested
          processCoords([coord]);
        } else {
          const [lng, lat] = coord;
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
        }
      });
    });
  };
  
  if (county.geometry.type === 'Polygon') {
    processCoords(county.geometry.coordinates);
  } else if (county.geometry.type === 'MultiPolygon') {
    county.geometry.coordinates.forEach(polygon => {
      processCoords(polygon);
    });
  }
});

console.log(`Bounding box: lng [${minLng}, ${maxLng}], lat [${minLat}, ${maxLat}]`);

// SVG dimensions
const svgWidth = 400;
const svgHeight = 500;
const padding = 20;

// Convert GeoJSON coordinates to SVG coordinates
function geoToSvg(lng, lat) {
  // Scale longitude to X (flipped because west is higher number)
  const x = padding + ((lng - minLng) / (maxLng - minLng)) * (svgWidth - 2 * padding);
  // Scale latitude to Y (inverted because SVG Y grows downward)
  const y = padding + ((maxLat - lat) / (maxLat - minLat)) * (svgHeight - 2 * padding);
  return [x, y];
}

// Convert a ring of coordinates to SVG path
function ringToPath(ring) {
  let path = '';
  ring.forEach((coord, i) => {
    const [x, y] = geoToSvg(coord[0], coord[1]);
    if (i === 0) {
      path += `M${x.toFixed(1)},${y.toFixed(1)}`;
    } else {
      path += `L${x.toFixed(1)},${y.toFixed(1)}`;
    }
  });
  path += 'Z';
  return path;
}

// Convert county geometry to SVG path
function geometryToPath(geometry) {
  let path = '';
  
  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach(ring => {
      path += ringToPath(ring);
    });
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach(polygon => {
      polygon.forEach(ring => {
        path += ringToPath(ring);
      });
    });
  }
  
  return path;
}

// District definitions
const districts = {
  7: ['Genesee', 'Lapeer', 'Sanilac', 'St. Clair', 'Huron', 'Tuscola'],
  8: ['Saginaw', 'Bay', 'Midland', 'Gratiot', 'Isabella', 'Clare', 'Gladwin', 'Arenac'],
  13: ['Livingston', 'Shiawassee', 'Clinton', 'Ingham', 'Eaton']
};

// Build county data
const countyData = michiganCounties.map(county => {
  const name = county.properties.NAME;
  const fips = county.properties.STATE + county.properties.COUNTY;
  const path = geometryToPath(county.geometry);
  
  // Find district
  let district = null;
  for (const [d, counties] of Object.entries(districts)) {
    if (counties.includes(name)) {
      district = parseInt(d);
      break;
    }
  }
  
  return {
    id: fips,
    name: name,
    path: path,
    district: district
  };
}).sort((a, b) => a.name.localeCompare(b.name));

// Generate the JavaScript file
const output = `// Michigan Counties Data
// Auto-generated from US Census Bureau GeoJSON data

export const DISTRICTS = {
  7: ['Genesee', 'Lapeer', 'Sanilac', 'St. Clair', 'Huron', 'Tuscola'],
  8: ['Saginaw', 'Bay', 'Midland', 'Gratiot', 'Isabella', 'Clare', 'Gladwin', 'Arenac'],
  13: ['Livingston', 'Shiawassee', 'Clinton', 'Ingham', 'Eaton']
};

export const MICHIGAN_COUNTIES = ${JSON.stringify(countyData, null, 2)};
`;

fs.writeFileSync('src/data/michiganCounties.js', output);
console.log('Generated src/data/michiganCounties.js');

// Also list counties for verification
console.log('\nCounties extracted:');
countyData.forEach(c => console.log(`  ${c.name}${c.district ? ` (District ${c.district})` : ''}`));
