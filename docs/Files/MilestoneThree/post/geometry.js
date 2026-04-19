const DEG_TO_RAD = Math.PI / 180;
const ACRES_PER_SQ_METER = 1 / 4046.8564224;
const SQ_MILES_PER_SQ_METER = 1 / 2589988.110336;

function metersPerDegree(avgLatDeg) {
  const r = avgLatDeg * DEG_TO_RAD;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * r) + 1.175 * Math.cos(4 * r),
    lng: 111412.84 * Math.cos(r) - 93.5 * Math.cos(3 * r),
  };
}

function stripClosingVertex(coords) {
  if (coords.length > 1) {
    const f = coords[0];
    const l = coords[coords.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) return coords.slice(0, -1);
  }
  return coords;
}

function closeRing(coords) {
  const ring = [...coords];
  if (ring.length > 0) {
    const f = ring[0];
    const l = ring[ring.length - 1];
    if (!l || f[0] !== l[0] || f[1] !== l[1]) ring.push([...f]);
  }
  return ring;
}

function pointInPolygon(point, ring) {
  const x = point[0];
  const y = point[1];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygonXY(point, polygon) {
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
}

function shoelaceAreaSqMeters(coords) {
  const open = stripClosingVertex([...coords]);
  if (open.length < 3) return 0;
  const avgLat = open.reduce((s, c) => s + c[1], 0) / open.length;
  const m = metersPerDegree(avgLat);
  let area = 0;
  const n = open.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = open[i][0] * m.lng, y1 = open[i][1] * m.lat;
    const x2 = open[j][0] * m.lng, y2 = open[j][1] * m.lat;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

function polygonArea(coords) {
  const sqm = shoelaceAreaSqMeters(coords);
  return {
    acres: sqm * ACRES_PER_SQ_METER,
    sqMiles: sqm * SQ_MILES_PER_SQ_METER,
  };
}

function polygonAreaAcres(coords) {
  return shoelaceAreaSqMeters(coords) * ACRES_PER_SQ_METER;
}

function rawShoelaceArea(ring) {
  if (!ring || ring.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(area / 2);
}

function rawShoelaceAreaXY(polygon) {
  if (!polygon || polygon.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    area += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y);
  }
  return Math.abs(area / 2);
}

function polygonBounds(coords) {
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  for (const [lng, lat] of coords) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

function generateGridInPolygon(ring, dynamicLimit) {
  const bounds = polygonBounds(ring);
  const latStep = (bounds.maxLat - bounds.minLat) / Math.sqrt(dynamicLimit);
  const lngStep = (bounds.maxLng - bounds.minLng) / Math.sqrt(dynamicLimit);

  const points = [];
  for (let lat = bounds.minLat; lat <= bounds.maxLat; lat += latStep) {
    for (let lng = bounds.minLng; lng <= bounds.maxLng; lng += lngStep) {
      if (pointInPolygon([lng, lat], ring)) {
        points.push({
          lat: parseFloat(lat.toFixed(6)),
          lng: parseFloat(lng.toFixed(6)),
        });
      }
      if (points.length >= dynamicLimit) break;
    }
    if (points.length >= dynamicLimit) break;
  }

  if (points.length === 0) {
    const expandFactor = 1.5;
    const centerLat = (bounds.minLat + bounds.maxLat) / 2;
    const centerLng = (bounds.minLng + bounds.maxLng) / 2;
    const eMinLat = centerLat - (centerLat - bounds.minLat) * expandFactor;
    const eMaxLat = centerLat + (bounds.maxLat - centerLat) * expandFactor;
    const eMinLng = centerLng - (centerLng - bounds.minLng) * expandFactor;
    const eMaxLng = centerLng + (bounds.maxLng - centerLng) * expandFactor;
    const eLatStep = (eMaxLat - eMinLat) / Math.sqrt(dynamicLimit);
    const eLngStep = (eMaxLng - eMinLng) / Math.sqrt(dynamicLimit);
    const fallbackLimit = Math.max(5, dynamicLimit / 10);

    for (let lat = eMinLat; lat <= eMaxLat; lat += eLatStep) {
      for (let lng = eMinLng; lng <= eMaxLng; lng += eLngStep) {
        if (pointInPolygon([lng, lat], ring)) {
          points.push({
            lat: parseFloat(lat.toFixed(6)),
            lng: parseFloat(lng.toFixed(6)),
          });
        }
        if (points.length >= fallbackLimit) break;
      }
      if (points.length >= fallbackLimit) break;
    }
  }

  return points;
}

function isLikelyLatLng(coords) {
  const hits = coords.filter((c) => {
    const lat = c[0];
    const lng = c[1];
    return lat >= 40 && lat <= 50 && lng >= -90 && lng <= -80;
  });
  return hits.length >= Math.ceil(coords.length * 0.75);
}

function swapPairs(coords) {
  return coords.map((c) => [c[1], c[0]]);
}

function reorderPolygon(coords) {
  if (!Array.isArray(coords) || coords.length < 3) return coords;
  const base = stripClosingVertex([...coords]);
  const centroid = base.reduce(
    (acc, c) => ({ lng: acc.lng + c[0], lat: acc.lat + c[1] }),
    { lng: 0, lat: 0 },
  );
  centroid.lng /= base.length;
  centroid.lat /= base.length;
  const sorted = base.sort((a, b) => {
    return Math.atan2(a[1] - centroid.lat, a[0] - centroid.lng) -
           Math.atan2(b[1] - centroid.lat, b[0] - centroid.lng);
  });
  return closeRing(sorted);
}

function validateCoordinates(coords) {
  if (!Array.isArray(coords) || coords.length < 3) {
    throw new Error('FAST FAIL: Invalid coordinates - must provide at least 3 points for a valid polygon');
  }
  for (const c of coords) {
    if (!Array.isArray(c) || c.length !== 2 ||
        typeof c[0] !== 'number' || typeof c[1] !== 'number' ||
        isNaN(c[0]) || isNaN(c[1])) {
      throw new Error('FAST FAIL: Invalid coordinate format - each coordinate must be [longitude, latitude] with numeric values');
    }
  }
}

function computeMedian(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function computeTrimmedMean(values, trimRatio = 0.1) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const trimCount = Math.floor(sorted.length * trimRatio);
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  const target = trimmed.length ? trimmed : sorted;
  return target.reduce((acc, v) => acc + v, 0) / target.length;
}

const _areaCache = new Map();

function cachedPolygonArea(coords, cacheKey) {
  if (cacheKey && _areaCache.has(cacheKey)) return _areaCache.get(cacheKey);
  const result = polygonArea(coords);
  if (cacheKey) _areaCache.set(cacheKey, result);
  return result;
}

function clearAreaCache() {
  _areaCache.clear();
}

function pointsClose(p1, p2, tolerance) {
  return Math.abs(p1.x - p2.x) < tolerance && Math.abs(p1.y - p2.y) < tolerance;
}

function polygonsAdjacentXY(poly1, poly2, tolerance = 1) {
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
}

function geometriesAdjacent(geom1, geom2, tolerance = 0.01) {
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
}

function buildAdjacencyList(items, getKey, getGeometry, adjacencyFn) {
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
}

function welshPowellColor(keys, adjacency, numColors) {
  const colorMap = {};
  const sorted = [...keys].sort((a, b) => (adjacency[b]?.length || 0) - (adjacency[a]?.length || 0));
  for (const key of sorted) {
    const usedColors = new Set();
    for (const neighbor of (adjacency[key] || [])) {
      if (colorMap[neighbor] !== undefined) usedColors.add(colorMap[neighbor]);
    }
    let assigned = false;
    for (let c = 0; c < numColors; c++) {
      if (!usedColors.has(c)) {
        colorMap[key] = c;
        assigned = true;
        break;
      }
    }
    if (!assigned) colorMap[key] = 0;
  }
  return colorMap;
}

function validateColoring(keys, adjacency, colorMap) {
  for (const key of keys) {
    const color = colorMap[key];
    for (const neighbor of (adjacency[key] || [])) {
      if (colorMap[neighbor] === color) {
        const usedColors = new Set(
          (adjacency[neighbor] || []).map((n) => colorMap[n]).filter((c) => c !== undefined)
        );
        for (let c = 0; c < 10; c++) {
          if (!usedColors.has(c) && c !== color) {
            colorMap[neighbor] = c;
            break;
          }
        }
      }
    }
  }
  return colorMap;
}

module.exports = {
  DEG_TO_RAD,
  ACRES_PER_SQ_METER,
  SQ_MILES_PER_SQ_METER,
  metersPerDegree,
  stripClosingVertex,
  closeRing,
  pointInPolygon,
  pointInPolygonXY,
  shoelaceAreaSqMeters,
  polygonArea,
  polygonAreaAcres,
  rawShoelaceArea,
  rawShoelaceAreaXY,
  polygonBounds,
  generateGridInPolygon,
  isLikelyLatLng,
  swapPairs,
  reorderPolygon,
  validateCoordinates,
  computeMedian,
  computeTrimmedMean,
  cachedPolygonArea,
  clearAreaCache,
  pointsClose,
  polygonsAdjacentXY,
  geometriesAdjacent,
  buildAdjacencyList,
  welshPowellColor,
  validateColoring,
};
