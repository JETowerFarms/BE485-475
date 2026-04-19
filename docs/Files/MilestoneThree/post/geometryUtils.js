const DEG_TO_RAD = Math.PI / 180;
const ACRES_PER_SQ_METER = 1 / 4046.8564224;
const SQ_MILES_PER_SQ_METER = 1 / 2589988.110336;
const MAX_GRID_POINTS = 25000;

const _areaCache = new Map();

function metersPerDegree(avgLatDeg) {
  const r = avgLatDeg * DEG_TO_RAD;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * r) + 1.175 * Math.cos(4 * r),
    lng: 111412.84 * Math.cos(r) - 93.5 * Math.cos(3 * r),
  };
}

export { DEG_TO_RAD, ACRES_PER_SQ_METER, SQ_MILES_PER_SQ_METER, metersPerDegree };

export const toCoordKey = (coord) => {
  if (!coord) return 'na';
  const [lng, lat] = coord;
  if (typeof lng !== 'number' || typeof lat !== 'number') return 'na';
  return `${lng.toFixed(6)}_${lat.toFixed(6)}`;
};

export const getStableFarmId = (farmId, coords) => {
  if (farmId) return farmId;
  if (Array.isArray(coords) && coords.length > 0) {
    const first = coords[0];
    const middle = coords[Math.floor(coords.length / 2)];
    const last = coords[coords.length - 1];
    return `poly-${coords.length}-${toCoordKey(first)}-${toCoordKey(middle)}-${toCoordKey(last)}`;
  }
  return 'poly-unknown';
};

export const formatUsd = (value) => {
  if (value === null || value === undefined) return 'Unknown';
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 'Unknown';
  return `$${Math.round(num).toLocaleString()}`;
};



export const validateCoordinates = (coordinates) => {
  if (!Array.isArray(coordinates) || coordinates.length < 3) {
    throw new Error(
      'FAST FAIL: Invalid coordinates - must provide at least 3 points for a valid polygon',
    );
  }
  for (const coord of coordinates) {
    if (
      !Array.isArray(coord) ||
      coord.length !== 2 ||
      typeof coord[0] !== 'number' ||
      typeof coord[1] !== 'number' ||
      isNaN(coord[0]) ||
      isNaN(coord[1])
    ) {
      throw new Error(
        'FAST FAIL: Invalid coordinate format - each coordinate must be [longitude, latitude] with numeric values',
      );
    }
  }
};

export const isLikelyLatLngMichigan = (coordinates) => {
  const hits = coordinates.filter((coord) => {
    const lat = coord[0];
    const lng = coord[1];
    return lat >= 40 && lat <= 50 && lng >= -90 && lng <= -80;
  });
  return hits.length >= Math.ceil(coordinates.length * 0.75);
};



export const closePolygonRing = (coordinates) => {
  const ring = [...coordinates];
  if (ring.length > 0) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (!last || first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([...first]);
    }
  }
  return ring;
};

export const swapCoordinatePairs = (coordinates) =>
  coordinates.map((coord) => [coord[1], coord[0]]);

export const reorderPolygon = (coordinates) => {
  if (!Array.isArray(coordinates) || coordinates.length < 3) return coordinates;

  const base = [...coordinates];
  const first = base[0];
  const last = base[base.length - 1];
  if (last && first && last[0] === first[0] && last[1] === first[1]) {
    base.pop();
  }

  const centroid = base.reduce(
    (acc, coord) => ({ lng: acc.lng + coord[0], lat: acc.lat + coord[1] }),
    { lng: 0, lat: 0 },
  );
  centroid.lng /= base.length;
  centroid.lat /= base.length;

  const sorted = base.sort((a, b) => {
    const angleA = Math.atan2(a[1] - centroid.lat, a[0] - centroid.lng);
    const angleB = Math.atan2(b[1] - centroid.lat, b[0] - centroid.lng);
    return angleA - angleB;
  });

  return closePolygonRing(sorted);
};



export const getPolygonBounds = (coordinates) => {
  if (!coordinates || coordinates.length === 0) {
    return { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 };
  }

  let minLat = Infinity,
    maxLat = -Infinity;
  let minLng = Infinity,
    maxLng = -Infinity;

  coordinates.forEach(([lng, lat]) => {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  });

  return { minLat, maxLat, minLng, maxLng };
};



export const toGridIndex = (value, origin, resolution) =>
  Math.round((value - origin) / resolution);

export const fromGridIndex = (index, origin, resolution) =>
  origin + index * resolution;

export const traceBoundaryGrid = (ring, resolution, bounds) => {
  const seen = new Set();
  const boundary = [];

  for (let i = 0; i + 1 < ring.length; i += 1) {
    const [lng0, lat0] = ring[i];
    const [lng1, lat1] = ring[i + 1];
    let x0 = toGridIndex(lng0, bounds.minLng, resolution);
    let y0 = toGridIndex(lat0, bounds.minLat, resolution);
    const x1 = toGridIndex(lng1, bounds.minLng, resolution);
    const y1 = toGridIndex(lat1, bounds.minLat, resolution);

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      const key = `${x0},${y0}`;
      if (!seen.has(key)) {
        seen.add(key);
        boundary.push([
          fromGridIndex(x0, bounds.minLng, resolution),
          fromGridIndex(y0, bounds.minLat, resolution),
        ]);
      }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  return boundary;
};

export const fillGridByBoundingBox = (resolution, bounds) => {
  const maxX = Math.round((bounds.maxLng - bounds.minLng) / resolution);
  const maxY = Math.round((bounds.maxLat - bounds.minLat) / resolution);
  const points = [];

  for (let y = maxY; y >= 0; y -= 1) {
    for (let x = 0; x <= maxX; x += 1) {
      points.push([
        fromGridIndex(x, bounds.minLng, resolution),
        fromGridIndex(y, bounds.minLat, resolution),
      ]);
    }
  }

  return points;
};

export const buildGridPointsFromResolution = (coordinates, resolution) => {
  validateCoordinates(coordinates);

  if (!Number.isFinite(resolution) || resolution <= 0) {
    throw new Error(
      'FAST FAIL: Invalid grid resolution - expected a positive number',
    );
  }

  const normalizedCoordinates = isLikelyLatLngMichigan(coordinates)
    ? swapCoordinatePairs(coordinates)
    : coordinates;

  const ring = closePolygonRing(normalizedCoordinates);
  const bounds = getPolygonBounds(ring);
  let fillPoints = fillGridByBoundingBox(resolution, bounds);
  let boundaryGridPoints = traceBoundaryGrid(ring, resolution, bounds);

  if (fillPoints.length === 0) {
    const reorderedRing = reorderPolygon(coordinates);
    const reorderedBounds = getPolygonBounds(reorderedRing);
    const reorderedFill = fillGridByBoundingBox(resolution, reorderedBounds);
    const reorderedBoundary = traceBoundaryGrid(reorderedRing, resolution, reorderedBounds);
    if (reorderedFill.length > 0) {
      return { ring: reorderedRing, gridPoints: reorderedFill, boundaryGridPoints: reorderedBoundary, fillPoints: reorderedFill };
    }

    const swapped = swapCoordinatePairs(coordinates);
    const swappedRing = closePolygonRing(swapped);
    const swappedBounds = getPolygonBounds(swappedRing);
    const swappedFill = fillGridByBoundingBox(resolution, swappedBounds);
    const swappedBoundary = traceBoundaryGrid(swappedRing, resolution, swappedBounds);
    if (swappedFill.length > 0) {
      return { ring: swappedRing, gridPoints: swappedFill, boundaryGridPoints: swappedBoundary, fillPoints: swappedFill };
    }

    const swappedReorderedRing = reorderPolygon(swapped);
    const swappedReorderedBounds = getPolygonBounds(swappedReorderedRing);
    const swappedReorderedFill = fillGridByBoundingBox(resolution, swappedReorderedBounds);
    const swappedReorderedBoundary = traceBoundaryGrid(swappedReorderedRing, resolution, swappedReorderedBounds);
    if (swappedReorderedFill.length > 0) {
      return { ring: swappedReorderedRing, gridPoints: swappedReorderedFill, boundaryGridPoints: swappedReorderedBoundary, fillPoints: swappedReorderedFill };
    }
  }

  if (fillPoints.length === 0) {
    throw new Error(
      'FAST FAIL: No grid points generated - invalid or degenerate farm boundary',
    );
  }

  if (fillPoints.length > MAX_GRID_POINTS) {
    throw new Error(
      `FAST FAIL: Too many grid points (${fillPoints.length}) - farm boundary too large for analysis`,
    );
  }

  return { ring, gridPoints: fillPoints, boundaryGridPoints, fillPoints };
};

export const normalizePolygon = (coordinates, size) => {
  if (!coordinates || coordinates.length === 0) return '';

  let coords = [...coordinates];
  if (coords.length > 1) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) {
      coords = coords.slice(0, -1);
    }
  }

  if (coords.length < 3) return '';

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  coords.forEach(([lng, lat]) => {
    minX = Math.min(minX, lng);
    maxX = Math.max(maxX, lng);
    minY = Math.min(minY, lat);
    maxY = Math.max(maxY, lat);
  });

  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  const padding = size * 0.1;
  const availableSize = size - padding * 2;
  const scale = Math.min(availableSize / width, availableSize / height);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  return coords
    .map(([lng, lat]) => {
      const x = padding + (lng - cx) * scale + availableSize / 2;
      const y = padding + (cy - lat) * scale + availableSize / 2;
      return `${x},${y}`;
    })
    .join(' ');
};

export const getPolygonTransform = (coordinates, size) => {
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('FAST FAIL: Invalid tile size for polygon transform');
  }
  if (!coordinates || coordinates.length < 3) {
    throw new Error(
      'FAST FAIL: Invalid coordinates - must provide at least 3 points for a valid polygon',
    );
  }

  let coords = [...coordinates];
  if (coords.length > 1) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) {
      coords = coords.slice(0, -1);
    }
  }

  if (coords.length < 3) {
    throw new Error('FAST FAIL: Invalid coordinates - polygon ring is degenerate');
  }

  let centroidX = 0;
  let centroidY = 0;
  coords.forEach(([lng, lat]) => {
    centroidX += lng;
    centroidY += lat;
  });
  centroidX /= coords.length;
  centroidY /= coords.length;

  const sortedCoords = [...coords].sort((a, b) => {
    const angleA = Math.atan2(a[1] - centroidY, a[0] - centroidX);
    const angleB = Math.atan2(b[1] - centroidY, b[0] - centroidX);
    return angleA - angleB;
  });

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  sortedCoords.forEach(([lng, lat]) => {
    minX = Math.min(minX, lng);
    maxX = Math.max(maxX, lng);
    minY = Math.min(minY, lat);
    maxY = Math.max(maxY, lat);
  });

  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  const padding = size * 0.1;
  const availableSize = size - padding * 2;
  const scale = Math.min(availableSize / width, availableSize / height);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const toPixel = (lng, lat) => ({
    x: padding + (lng - cx) * scale + availableSize / 2,
    y: padding + (cy - lat) * scale + availableSize / 2,
  });

  return { toPixel, scale };
};



export const calculatePolygonArea = (coordinates, cacheKey) => {
  if (cacheKey && _areaCache.has(cacheKey)) return _areaCache.get(cacheKey);
  if (!coordinates || coordinates.length < 3) return { acres: 0, sqMiles: 0 };

  let coords = [...coordinates];
  if (coords.length > 1) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) {
      coords = coords.slice(0, -1);
    }
  }

  const avgLat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
  const m = metersPerDegree(avgLat);

  let area = 0;
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = coords[i][0] * m.lng;
    const y1 = coords[i][1] * m.lat;
    const x2 = coords[j][0] * m.lng;
    const y2 = coords[j][1] * m.lat;
    area += x1 * y2 - x2 * y1;
  }
  area = Math.abs(area) / 2;

  const result = {
    acres: area * ACRES_PER_SQ_METER,
    sqMiles: area * SQ_MILES_PER_SQ_METER,
  };
  if (cacheKey) _areaCache.set(cacheKey, result);
  return result;
};

export const clearAreaCache = () => _areaCache.clear();

export const computeCentroidLatLng = (coordinates) => {
  if (!Array.isArray(coordinates) || coordinates.length === 0)
    return { lat: 0, lon: 0 };
  let sumLat = 0;
  let sumLon = 0;
  coordinates.forEach(([lng, lat]) => {
    sumLat += lat;
    sumLon += lng;
  });
  return { lat: sumLat / coordinates.length, lon: sumLon / coordinates.length };
};

// Computes SVG tile data for a farm in a given view type.
export const getViewData = (farmId, coords, tileSize, viewTypeId, options = {}) => {
  const bounds = getPolygonBounds(coords);
  const polygonPoints = normalizePolygon(coords, tileSize);
  const gridResolution =
    options.gridResolution ??
    options.farm?.backendAnalysis?.metadata?.grid?.resolution;

  if (viewTypeId === 'satellite') {
    const zoom = 17;
    const lat2tile = (lat, z) =>
      ((1 -
        Math.log(
          Math.tan((lat * Math.PI) / 180) +
            1 / Math.cos((lat * Math.PI) / 180),
        ) /
          Math.PI) /
        2) *
      Math.pow(2, z);
    const lng2tile = (lng, z) =>
      ((lng + 180) / 360) * Math.pow(2, z);

    const minTileX = lng2tile(bounds.minLng, zoom);
    const maxTileX = lng2tile(bounds.maxLng, zoom);
    const minTileY = lat2tile(bounds.maxLat, zoom);
    const maxTileY = lat2tile(bounds.minLat, zoom);

    const tileXStart = Math.floor(minTileX);
    const tileYStart = Math.floor(minTileY);
    const tileXEnd = Math.floor(maxTileX);
    const tileYEnd = Math.floor(maxTileY);

    const satellitePadding = tileSize * 0.1;
    const satelliteAvailableSize = tileSize - satellitePadding * 2;
    const geoWidth = bounds.maxLng - bounds.minLng || 0.0001;
    const geoHeight = bounds.maxLat - bounds.minLat || 0.0001;
    const scale = Math.min(
      satelliteAvailableSize / geoWidth,
      satelliteAvailableSize / geoHeight,
    );
    const geoCenterLng = (bounds.minLng + bounds.maxLng) / 2;
    const geoCenterLat = (bounds.minLat + bounds.maxLat) / 2;

    const lngLatToPixel = (lng, lat) => ({
      x: satellitePadding + (lng - geoCenterLng) * scale + satelliteAvailableSize / 2,
      y: satellitePadding + (geoCenterLat - lat) * scale + satelliteAvailableSize / 2,
    });

    const getTileBounds = (tileX, tileY, z) => {
      const tileLngMin = (tileX / Math.pow(2, z)) * 360 - 180;
      const tileLngMax = ((tileX + 1) / Math.pow(2, z)) * 360 - 180;
      const n1 = Math.PI - (2 * Math.PI * tileY) / Math.pow(2, z);
      const n2 = Math.PI - (2 * Math.PI * (tileY + 1)) / Math.pow(2, z);
      const tileLatMax =
        (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n1) - Math.exp(-n1)));
      const tileLatMin =
        (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n2) - Math.exp(-n2)));
      return { tileLngMin, tileLngMax, tileLatMin, tileLatMax };
    };

    const tiles = [];
    for (let ty = tileYStart; ty <= tileYEnd; ty++) {
      for (let tx = tileXStart; tx <= tileXEnd; tx++) {
        const tileBounds = getTileBounds(tx, ty, zoom);
        const tileTopLeft = lngLatToPixel(tileBounds.tileLngMin, tileBounds.tileLatMax);
        const tileBottomRight = lngLatToPixel(tileBounds.tileLngMax, tileBounds.tileLatMin);
        tiles.push({
          url: `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`,
          x: tileTopLeft.x,
          y: tileTopLeft.y,
          width: tileBottomRight.x - tileTopLeft.x,
          height: tileBottomRight.y - tileTopLeft.y,
          tileX: tx,
          tileY: ty,
        });
      }
    }

    return { bounds, polygonPoints, tiles };
  }

  if (viewTypeId === 'solar' || viewTypeId === 'elevation') {
    if (!Number.isFinite(gridResolution)) {
      throw new Error(
        `FAST FAIL: Missing grid resolution for farm ${farmId || 'unknown'}`,
      );
    }

    const { ring, gridPoints, boundaryGridPoints, fillPoints } =
      buildGridPointsFromResolution(coords, gridResolution);

    const backendBoundaryPoints =
      options.farm?.backendAnalysis?.metadata?.grid?.boundaryPoints;
    const boundaryPoints =
      Array.isArray(backendBoundaryPoints) && backendBoundaryPoints.length > 0
        ? backendBoundaryPoints
        : boundaryGridPoints;

    const boundaryKeySet = new Set(
      boundaryPoints
        .filter((p) => Array.isArray(p) && p.length === 2)
        .map((p) => `${Number(p[0]).toFixed(6)},${Number(p[1]).toFixed(6)}`),
    );

    const backendGridPoints = Array.isArray(
      options.farm?.backendAnalysis?.metadata?.grid?.gridPoints,
    )
      ? options.farm?.backendAnalysis?.metadata?.grid?.gridPoints
      : null;

    const resultsKey = viewTypeId === 'solar' ? 'solarSuitability' : 'elevation';
    const resultList = options.farm?.backendAnalysis?.[resultsKey]?.results;
    const colorMap = new Map(
      Array.isArray(resultList)
        ? resultList
            .map((result) => {
              const c = result?.coordinates;
              if (!Array.isArray(c) || c.length !== 2) return null;
              const color = result?.heatmap_color;
              if (typeof color !== 'string' || color.trim() === '') return null;
              return [`${Number(c[0]).toFixed(6)},${Number(c[1]).toFixed(6)}`, color];
            })
            .filter(Boolean)
        : [],
    );

    const solidPoints =
      backendGridPoints && backendGridPoints.length > 0
        ? backendGridPoints
        : gridPoints;
    const solidSet = new Set(
      solidPoints
        .filter((p) => Array.isArray(p) && p.length === 2)
        .map((p) => `${Number(p[0]).toFixed(6)},${Number(p[1]).toFixed(6)}`),
    );

    const guessedPoints = fillPoints.filter((p) => {
      if (!Array.isArray(p) || p.length !== 2) return false;
      const key = `${Number(p[0]).toFixed(6)},${Number(p[1]).toFixed(6)}`;
      return !solidSet.has(key) && !boundaryKeySet.has(key);
    });

    const combinedPoints = (() => {
      const seen = new Set();
      const merged = [];
      for (const p of [...solidPoints, ...boundaryPoints]) {
        if (!Array.isArray(p) || p.length !== 2) continue;
        const key = `${Number(p[0]).toFixed(6)},${Number(p[1]).toFixed(6)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(p);
      }
      return merged;
    })();

    const transform = getPolygonTransform(ring, tileSize);
    const cellWidth = gridResolution * transform.scale;
    const cellHeight = gridResolution * transform.scale;

    const gridCells = [...combinedPoints, ...guessedPoints].map((point, index) => {
      const { x, y } = transform.toPixel(point[0], point[1]);
      const key = `${Number(point[0]).toFixed(6)},${Number(point[1]).toFixed(6)}`;
      return {
        key: `${farmId || 'farm'}-${viewTypeId}-${index}`,
        x: x - cellWidth / 2,
        y: y - cellHeight / 2,
        width: cellWidth,
        height: cellHeight,
        isGuess: index >= combinedPoints.length,
        isBoundary: boundaryKeySet.has(key),
        fillColor: colorMap.get(key) || null,
      };
    });

    return {
      bounds: getPolygonBounds(ring),
      polygonPoints: normalizePolygon(ring, tileSize),
      gridCells,
      gridResolution,
    };
  }

  return null;
};
