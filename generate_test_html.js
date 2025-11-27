const fs = require('fs');
const data = require('./src/data/michiganMCDSimplified.json');

const huron = data.features.filter(f => f.properties.county === 'Huron');
const LAT_CORRECTION = Math.cos(43 * Math.PI / 180);

// Calculate bounds
let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
huron.forEach(f => {
  if (f.properties.bbox) {
    minLng = Math.min(minLng, f.properties.bbox.minLng);
    maxLng = Math.max(maxLng, f.properties.bbox.maxLng);
    minLat = Math.min(minLat, f.properties.bbox.minLat);
    maxLat = Math.max(maxLat, f.properties.bbox.maxLat);
  }
});
const lngPad = (maxLng - minLng) * 0.05;
const latPad = (maxLat - minLat) * 0.05;
const bounds = {
  minLng: minLng - lngPad,
  maxLng: maxLng + lngPad,
  minLat: minLat - latPad,
  maxLat: maxLat + latPad
};

const svgW = 600, svgH = 700;

const geoToSvg = (lng, lat) => {
  const corrW = (bounds.maxLng - bounds.minLng) * LAT_CORRECTION;
  const geoH = bounds.maxLat - bounds.minLat;
  const scX = svgW / corrW;
  const scY = svgH / geoH;
  const sc = Math.min(scX, scY);
  const actW = corrW * sc;
  const actH = geoH * sc;
  const offX = (svgW - actW) / 2;
  const offY = (svgH - actH) / 2;
  const x = offX + (lng - bounds.minLng) * LAT_CORRECTION * sc;
  const y = offY + (bounds.maxLat - lat) * sc;
  return { x: x.toFixed(1), y: y.toFixed(1) };
};

const coordsToPath = (coords) => {
  let p = '';
  coords.forEach(([lng, lat], i) => {
    const { x, y } = geoToSvg(lng, lat);
    p += i === 0 ? `M${x},${y}` : `L${x},${y}`;
  });
  return p + 'Z';
};

let paths = [];
huron.forEach((f, i) => {
  let path;
  if (f.geometry.type === 'Polygon') {
    path = coordsToPath(f.geometry.coordinates[0]);
  } else {
    path = f.geometry.coordinates.map(p => coordsToPath(p[0])).join(' ');
  }
  const hue = (i * 37) % 360;
  paths.push({
    name: f.properties.namelsad,
    path,
    fill: `hsl(${hue}, 35%, 75%)`
  });
});

const html = `<!DOCTYPE html>
<html>
<head>
  <title>Huron County Test</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    svg { border: 1px solid #ccc; }
    path:hover { opacity: 0.7; }
    .legend { margin-top: 20px; }
    .legend-item { display: inline-block; margin: 5px 10px; }
    .legend-color { width: 16px; height: 16px; display: inline-block; border: 1px solid #333; margin-right: 5px; vertical-align: middle; }
  </style>
</head>
<body>
  <h1>Huron County SVG Test</h1>
  <p>Hover over shapes to see names. This is pure HTML/SVG to verify paths are correct.</p>
  <svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
    ${paths.map(p => `<path d="${p.path}" fill="${p.fill}" stroke="#333" stroke-width="0.5"><title>${p.name}</title></path>`).join('\n    ')}
  </svg>
  <div class="legend">
    <h3>Legend (hover over shapes to verify)</h3>
    ${paths.map(p => `<div class="legend-item"><span class="legend-color" style="background: ${p.fill}"></span>${p.name}</div>`).join('\n    ')}
  </div>
</body>
</html>`;

fs.writeFileSync('test_huron.html', html);
console.log('Created test_huron.html - open it in a browser to verify paths');
