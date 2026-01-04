const express = require('express');
const { db, isDbConnectionError, getDbConnectionHint } = require('../database');

const router = express.Router();

// GET /api/crops?q=apple&limit=200
// Returns lightweight crop list for UI dropdowns.
router.get('/', async (req, res, next) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 200;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 200;

  try {
    const params = [];
    let whereClause = '';

    if (q) {
      params.push(`%${q}%`);
      whereClause = `WHERE name ILIKE $1 OR crop ILIKE $1 OR category ILIKE $1`;
    }

    const crops = await db.any(
      `SELECT id, crop, name, category
       FROM crops
       ${whereClause}
       ORDER BY name ASC
       LIMIT ${limit}`,
      params
    );

    res.json({
      count: crops.length,
      crops,
    });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return res.status(503).json({
        error: 'DatabaseUnavailable',
        message: 'Database connection unavailable. Crop list cannot be loaded.',
        hint: getDbConnectionHint(),
      });
    }
    return next(error);
  }
});

module.exports = router;
