const express = require('express');
const { db, isDbConnectionError, getDbConnectionHint } = require('../database');

const router = express.Router();

const CROP_COLUMNS = [
  'id',
  'crop',
  'name',
  'category',
  'yield_per_acre',
  'price_per_unit_0',
  'unit',
  'cost_per_acre',
  'escalation_rate',
];

const SELECT_COLUMNS = CROP_COLUMNS.join(', ');

function sanitizeCropPayload(body, { requireAll = false } = {}) {
  const errors = [];

  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const crop = typeof body?.crop === 'string' ? body.crop.trim() : name;
  const category = typeof body?.category === 'string' ? body.category.trim() : null;
  const unit = typeof body?.unit === 'string' ? body.unit.trim() : '';

  const parseNum = (value, field) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num)) {
      errors.push(`${field} must be a number`);
      return null;
    }
    return num;
  };

  const yieldPerAcre = parseNum(body?.yield_per_acre, 'yield_per_acre');
  const pricePerUnit0 = parseNum(body?.price_per_unit_0, 'price_per_unit_0');
  const costPerAcre = parseNum(body?.cost_per_acre, 'cost_per_acre');
  const escalationRate = parseNum(body?.escalation_rate, 'escalation_rate');

  const requireFields = requireAll ? ['name', 'unit', 'yield_per_acre', 'price_per_unit_0', 'cost_per_acre'] : [];
  requireFields.forEach((field) => {
    const value = { name, unit, yield_per_acre: yieldPerAcre, price_per_unit_0: pricePerUnit0, cost_per_acre: costPerAcre }[field];
    if (value === null || value === undefined || value === '') {
      errors.push(`${field} is required`);
    }
  });

  return {
    errors,
    payload: {
      name,
      crop,
      category,
      unit,
      yield_per_acre: yieldPerAcre,
      price_per_unit_0: pricePerUnit0,
      cost_per_acre: costPerAcre,
      escalation_rate: escalationRate ?? 0,
    },
  };
}

function dbUnavailable(res) {
  return res.status(503).json({
    error: 'DatabaseUnavailable',
    message: 'Database connection unavailable. Crop request failed.',
    hint: getDbConnectionHint(),
  });
}

// GET /api/crops?q=apple&limit=200
// Returns crop list for UI dropdowns and editing.
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
      `SELECT ${SELECT_COLUMNS}
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
      return dbUnavailable(res);
    }
    return next(error);
  }
});

// GET /api/crops/:id
router.get('/:id', async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'BadRequest', message: 'Invalid crop id' });
  }

  try {
    const crop = await db.oneOrNone(`SELECT ${SELECT_COLUMNS} FROM crops WHERE id = $1`, [id]);
    if (!crop) {
      return res.status(404).json({ error: 'NotFound', message: 'Crop not found' });
    }
    res.json(crop);
  } catch (error) {
    if (isDbConnectionError(error)) {
      return dbUnavailable(res);
    }
    return next(error);
  }
});

// POST /api/crops
router.post('/', async (req, res, next) => {
  const { errors, payload } = sanitizeCropPayload(req.body, { requireAll: true });
  if (errors.length) {
    return res.status(422).json({ error: 'ValidationError', message: 'Invalid crop payload', details: errors });
  }

  try {
    const inserted = await db.one(
      `INSERT INTO crops (crop, name, category, yield_per_acre, price_per_unit_0, unit, cost_per_acre, escalation_rate)
       VALUES ($/crop/, $/name/, $/category/, $/yield_per_acre/, $/price_per_unit_0/, $/unit/, $/cost_per_acre/, $/escalation_rate/)
       RETURNING ${SELECT_COLUMNS}`,
      payload
    );

    res.status(201).json(inserted);
  } catch (error) {
    if (isDbConnectionError(error)) {
      return dbUnavailable(res);
    }
    return next(error);
  }
});

// PUT /api/crops/:id
router.put('/:id', async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'BadRequest', message: 'Invalid crop id' });
  }

  const { errors, payload } = sanitizeCropPayload(req.body, { requireAll: false });
  if (errors.length) {
    return res.status(422).json({ error: 'ValidationError', message: 'Invalid crop payload', details: errors });
  }

  const updates = [];
  const params = { ...payload, id };

  Object.entries(payload).forEach(([key, value]) => {
    const shouldUpdate =
      value !== undefined &&
      (key === 'category' ? true : value !== null && value !== '');
    if (shouldUpdate) {
      updates.push(`${key} = $/${key}/`);
    }
  });

  if (updates.length === 0) {
    return res.status(400).json({ error: 'BadRequest', message: 'No fields to update' });
  }

  try {
    const updated = await db.oneOrNone(
      `UPDATE crops
          SET ${updates.join(', ')}
        WHERE id = $/id/
      RETURNING ${SELECT_COLUMNS}`,
      params
    );

    if (!updated) {
      return res.status(404).json({ error: 'NotFound', message: 'Crop not found' });
    }

    res.json(updated);
  } catch (error) {
    if (isDbConnectionError(error)) {
      return dbUnavailable(res);
    }
    return next(error);
  }
});

// DELETE /api/crops/:id
router.delete('/:id', async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'BadRequest', message: 'Invalid crop id' });
  }

  try {
    const deleted = await db.oneOrNone('DELETE FROM crops WHERE id = $1 RETURNING id', [id]);
    if (!deleted) {
      return res.status(404).json({ error: 'NotFound', message: 'Crop not found' });
    }
    res.json({ success: true, id });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return dbUnavailable(res);
    }
    return next(error);
  }
});

module.exports = router;
