// Mock for concaveman
module.exports = jest.fn((points) => {
  // Return a simple polygon from the points
  if (!points || points.length < 3) return [];
  return points;
});