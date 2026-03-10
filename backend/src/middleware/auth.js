const jwt = require('jsonwebtoken');

/**
 * Express middleware that verifies a Bearer JWT on every request.
 * Attaches the decoded payload to req.user on success.
 * Returns 401 if the token is missing, invalid, or expired.
 */
const requireAuth = (req, res, next) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[auth] JWT_SECRET is not set — refusing all authenticated requests');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7); // strip "Bearer "
  try {
    const payload = jwt.verify(token, secret);
    req.user = payload;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Unauthorized', message: 'Session expired — please log in again' });
    }
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
  }
};

module.exports = { requireAuth };
