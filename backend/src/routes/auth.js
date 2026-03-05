const express = require('express');
const Joi = require('joi');
const { db } = require('../database');

const router = express.Router();

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

    // Simple stateless response; no session/token issuance for now
    res.json({ success: true, user: row });
  } catch (err) {
    res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

module.exports = router;
