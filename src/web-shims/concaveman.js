// Web shim for concaveman (native C++ addon)
// Uses a simple convex hull fallback — adequate for display purposes
module.exports = function concaveman(points) {
  if (!points || points.length < 3) return points ? [...points] : [];

  // Graham scan convex hull
  const pts = points.map((p, i) => ({ x: p[0], y: p[1], i }));
  pts.sort((a, b) => a.x - b.x || a.y - b.y);

  const cross = (O, A, B) =>
    (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }

  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  const hull = lower.concat(upper);
  return hull.map((p) => [p.x, p.y]);
};
