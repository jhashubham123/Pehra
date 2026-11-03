// Checks the "Authorization: Bearer <token>" header and fills req.auth.
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

module.exports = (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new ApiError(401, 'Please log in first.'));

  try {
    const p = jwt.verify(token, env.jwtSecret);
    req.auth = {
      userId: p.sub,
      role: p.role, // admin | guard | resident | user
      societyId: p.society_id,
      profileId: p.profile_id, // society_staff.id or residents.id
      gateId: p.gate_id, // guards only, once the phone is paired
      status: p.status, // active | pending | declined
    };
    next();
  } catch (err) {
    const message = err.name === 'TokenExpiredError' ? 'Session expired. Please refresh.' : 'Invalid token.';
    next(new ApiError(401, message));
  }
};
