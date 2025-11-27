const fs = require('fs');
const data = JSON.parse(fs.readFileSync('./michigan_mcd_full.geojson', 'utf8'));

const targetCountyFIPS = ['055','035','045','063','087','099','145','151','155','157','017','037','049','057','065','073','111','125','091','093'];
const countyNames = {
  '055':'Grand Traverse','035':'Clare','045':'Eaton','063':'Huron','087':'Lapeer',
  '099':'Macomb','145':'Saginaw','151':'Sanilac','155':'Shiawassee','157':'Tuscola',
  '017':'Bay','037':'Clinton','049':'Genesee','057':'Gratiot','065':'Ingham',
  '073':'Isabella','111':'Midland','125':'Oakland','091':'Lenawee','093':'Livingston'
};

const filtered = data.features.filter(f => 
  targetCountyFIPS.includes(f.properties.COUNTYFP) && 
  f.properties.NAME !== 'County subdivisions not defined'
);

const processed = filtered.map(f => {
  let allCoords = [];
  if (f.geometry.type === 'Polygon') {
    allCoords = f.geometry.coordinates[0];
  } else {
    f.geometry.coordinates.forEach(p => allCoords.push(...p[0]));
  }
  
  const lngs = allCoords.map(c => c[0]);
  const lats = allCoords.map(c => c[1]);
  
  return {
    type: 'Feature',
    properties: {
      name: f.properties.NAME,
      namelsad: f.properties.NAMELSAD,
      county: countyNames[f.properties.COUNTYFP],
      geoid: f.properties.GEOID,
      centroid: { 
        lng: (Math.min(...lngs) + Math.max(...lngs)) / 2, 
        lat: (Math.min(...lats) + Math.max(...lats)) / 2 
      },
      bbox: { 
        minLng: Math.min(...lngs), 
        maxLng: Math.max(...lngs), 
        minLat: Math.min(...lats), 
        maxLat: Math.max(...lats) 
      }
    },
    geometry: f.geometry
  };
});

processed.sort((a, b) => {
  if (a.properties.county !== b.properties.county) {
    return a.properties.county.localeCompare(b.properties.county);
  }
  return a.properties.namelsad.localeCompare(b.properties.namelsad);
});

const output = { type: 'FeatureCollection', features: processed };
fs.writeFileSync('./src/data/michiganMCDSimplified.json', JSON.stringify(output));

console.log('Wrote', processed.length, 'features');
console.log('File size:', (fs.statSync('./src/data/michiganMCDSimplified.json').size / 1024 / 1024).toFixed(2), 'MB');
