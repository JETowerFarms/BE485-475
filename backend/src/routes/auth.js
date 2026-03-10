const express = require('express');
const Joi = require('joi');
const jwt = require('jsonwebtoken');
const { db } = require('../database');

const router = express.Router();

const TOKEN_EXPIRY = process.env.JWT_EXPIRY || '8h';

const loginSchema = Joi.object({
  username: Joi.string().trim().min(1).required(),
  password: Joi.string().min(1).required(),
});

router.post('/login', async (req, res) => {
  try {
    const { value, error } = loginSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(422).json({ error: 'Validation failed', details: error.details.map((d) => d.message) });
    }

    const { username, password } = value;
    const row = await db.oneOrNone(
      'SELECT id, username FROM users WHERE username = $1 AND password_hash = crypt($2, password_hash)',
      [username, password]
    );

    if (!row) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('[auth] JWT_SECRET is not set');
      return res.status(500).json({ error: 'Server misconfiguration' });
    }

    const token = jwt.sign(
      { sub: row.id, username: row.username },
      secret,
      { expiresIn: TOKEN_EXPIRY }
    );

    res.json({ success: true, user: { id: row.id, username: row.username }, token });
  } catch (err) {
    res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

module.exports = router;
