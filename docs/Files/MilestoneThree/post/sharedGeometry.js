export const pointInPolygonXY = (point, polygon) => {
  if (!polygon || polygon.length < 3) return false;
  const { x, y } = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
};

export const rawShoelaceAreaXY = (polygon) => {
  if (!polygon || polygon.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    area += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y);
  }
  return Math.abs(area / 2);
};

export const rawShoelaceArea = (ring) => {
  if (!ring || ring.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(area / 2);
};

export const polygonsAdjacentXY = (poly1, poly2, tolerance = 1) => {
  const pointSet = new Set();
  for (const p of poly2) {
    pointSet.add(`${Math.round(p.x / tolerance)}_${Math.round(p.y / tolerance)}`);
  }
  let shared = 0;
  for (const p of poly1) {
    if (pointSet.has(`${Math.round(p.x / tolerance)}_${Math.round(p.y / tolerance)}`)) {
      shared++;
      if (shared >= 2) return true;
    }
  }
  return false;
};

export const geometriesAdjacent = (geom1, geom2, tolerance = 0.01) => {
  const getRings = (g) => {
    if (!g) return [];
    if (g.type === 'Polygon') return [g.coordinates[0]];
    if (g.type === 'MultiPolygon') return g.coordinates.map((p) => p[0]);
    return [];
  };
  const rings1 = getRings(geom1);
  const rings2 = getRings(geom2);
  const pointSet = new Set();
  for (const ring of rings2) {
    for (const p of ring) {
      pointSet.add(`${Math.round(p[0] / tolerance)}_${Math.round(p[1] / tolerance)}`);
    }
  }
  let shared = 0;
  for (const ring of rings1) {
    for (const p of ring) {
      if (pointSet.has(`${Math.round(p[0] / tolerance)}_${Math.round(p[1] / tolerance)}`)) {
        shared++;
        if (shared >= 2) return true;
      }
    }
  }
  return false;
};

export const buildAdjacencyList = (items, getKey, getGeometry, adjacencyFn) => {
  const adjacency = {};
  items.forEach((item) => { adjacency[getKey(item)] = []; });
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (adjacencyFn(getGeometry(items[i]), getGeometry(items[j]))) {
        adjacency[getKey(items[i])].push(getKey(items[j]));
        adjacency[getKey(items[j])].push(getKey(items[i]));
      }
    }
  }
  return adjacency;
};

export const welshPowellColor = (keys, adjacency, numColors, offset = 0) => {
  const colorMap = {};
  const sorted = [...keys].sort((a, b) => (adjacency[b]?.length || 0) - (adjacency[a]?.length || 0));
  for (const key of sorted) {
    const usedColors = new Set();
    for (const neighbor of (adjacency[key] || [])) {
      if (colorMap[neighbor] !== undefined) usedColors.add(colorMap[neighbor]);
    }
    let assigned = false;
    for (let c = 0; c < numColors; c++) {
      const idx = (c + offset) % numColors;
      if (!usedColors.has(idx)) {
        colorMap[key] = idx;
        assigned = true;
        break;
      }
    }
    if (!assigned) colorMap[key] = offset % numColors;
  }
  return colorMap;
};

export const validateColoring = (keys, adjacency, colorMap, numColors) => {
  for (const key of keys) {
    const color = colorMap[key];
    for (const neighbor of (adjacency[key] || [])) {
      if (colorMap[neighbor] === color) {
        const usedColors = new Set(
          (adjacency[neighbor] || []).map((n) => colorMap[n]).filter((c) => c !== undefined)
        );
        for (let c = 0; c < (numColors || 10); c++) {
          if (!usedColors.has(c) && c !== color) {
            colorMap[neighbor] = c;
            break;
          }
        }
      }
    }
  }
  return colorMap;
};
