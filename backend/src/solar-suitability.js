/**
 * Solar Suitability Analysis Module
 * Queries and processes solar suitability data from the database
 */

/**
 * Calculate average solar suitability score from data points
 * @param {Array} points - Array of solar data points with score properties
 * @returns {Object} Average scores for all categories
 */
function calculateAverageSolarScores(points) {
  if (!points || points.length === 0) {
    return {
      overall: 0,
      landCover: 0,
      slope: 0,
      transmission: 0,
      population: 0,
      pointCount: 0,
    };
  }

  const sums = {
    overall: 0,
    landCover: 0,
    slope: 0,
    transmission: 0,
    population: 0,
  };

  for (const point of points) {
    sums.overall += parseFloat(point.overall_score) || 0;
    sums.landCover += parseFloat(point.land_cover_score) || 0;
    sums.slope += parseFloat(point.slope_score) || 0;
    sums.transmission += parseFloat(point.transmission_score) || 0;
    sums.population += parseFloat(point.population_score) || 0;
  }

  const count = points.length;
  return {
    overall: sums.overall / count,
    landCover: sums.landCover / count,
    slope: sums.slope / count,
    transmission: sums.transmission / count,
    population: sums.population / count,
    pointCount: count,
  };
}

/**
 * Convert solar suitability score to RGB color
 * Red (low score) -> Yellow -> Green (high score)
 * @param {number} score - Solar suitability score (0-100)
 * @returns {string} RGB color string "rgb(r, g, b)"
 */
function scoreToColor(score) {
  const clampedScore = Math.max(0, Math.min(100, score));
  
  if (clampedScore < 50) {
    // Red to Yellow (0-50)
    const ratio = clampedScore / 50;
    const r = 255;
    const g = Math.round(255 * ratio);
    const b = 0;
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // Yellow to Green (50-100)
    const ratio = (clampedScore - 50) / 50;
    const r = Math.round(255 * (1 - ratio));
    const g = 255;
    const b = 0;
    return `rgb(${r}, ${g}, ${b})`;
  }
}

/**
 * Generate heatmap grid for visualization
 * @param {Array} points - Solar data points
 * @param {Object} bounds - Bounding box {minLat, maxLat, minLng, maxLng}
 * @param {number} gridSize - Number of grid cells per dimension
 * @returns {Array} Grid of cells with colors
 */
function generateSolarHeatMapGrid(points, bounds, gridSize = 50) {
  if (!points || points.length === 0) {
    return [];
  }

  const latStep = (bounds.maxLat - bounds.minLat) / gridSize;
  const lngStep = (bounds.maxLng - bounds.minLng) / gridSize;
  
  const grid = [];
  
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const cellMinLat = bounds.minLat + i * latStep;
      const cellMaxLat = cellMinLat + latStep;
      const cellMinLng = bounds.minLng + j * lngStep;
      const cellMaxLng = cellMinLng + lngStep;
      
      // Find points within this cell
      const cellPoints = points.filter(p => 
        p.lat >= cellMinLat && p.lat < cellMaxLat &&
        p.lng >= cellMinLng && p.lng < cellMaxLng
      );
      
      if (cellPoints.length > 0) {
        // Average score for this cell
        const avgScore = cellPoints.reduce((sum, p) => sum + (parseFloat(p.overall_score) || 0), 0) / cellPoints.length;
        
        grid.push({
          lat: (cellMinLat + cellMaxLat) / 2,
          lng: (cellMinLng + cellMaxLng) / 2,
          score: avgScore,
          color: scoreToColor(avgScore),
          bounds: {
            minLat: cellMinLat,
            maxLat: cellMaxLat,
            minLng: cellMinLng,
            maxLng: cellMaxLng,
          }
        });
      }
    }
  }
  
  return grid;
}

/**
 * Get score distribution for statistics
 * @param {Array} points - Solar data points
 * @returns {Object} Distribution statistics
 */
function getSolarScoreDistribution(points) {
  if (!points || points.length === 0) {
    return {
      min: 0,
      max: 0,
      median: 0,
      q25: 0,
      q75: 0,
    };
  }

  const scores = points
    .map(p => parseFloat(p.overall_score) || 0)
    .sort((a, b) => a - b);

  const q25Index = Math.floor(scores.length * 0.25);
  const medianIndex = Math.floor(scores.length * 0.5);
  const q75Index = Math.floor(scores.length * 0.75);

  return {
    min: scores[0],
    max: scores[scores.length - 1],
    median: scores[medianIndex],
    q25: scores[q25Index],
    q75: scores[q75Index],
  };
}

module.exports = {
  calculateAverageSolarScores,
  scoreToColor,
  generateSolarHeatMapGrid,
  getSolarScoreDistribution,
};
