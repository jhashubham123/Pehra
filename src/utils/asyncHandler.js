// Wraps an async controller so errors go to the error handler automatically.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
