// Allows only the listed roles, e.g. authorizeRole('admin') or authorizeRole('admin', 'guard').
// A resident whose request is still pending is not "active", so they are blocked here.
const ApiError = require('../utils/ApiError');

module.exports = (...roles) => (req, res, next) => {
  if (!req.auth || !roles.includes(req.auth.role)) {
    return next(new ApiError(403, 'You do not have permission to do this.'));
  }
  if (req.auth.status !== 'active') {
    return next(new ApiError(403, 'Your account is not active yet.'));
  }
  next();
};
