// Last stop for every error. Sends one clean JSON shape: { success: false, message }.
const env = require('../config/env');
const logger = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Request body is not valid JSON.' });
  }

  if (err.status) {
    return res.status(err.status).json({ success: false, message: err.message, errors: err.errors });
  }

  if (err.code === '23505') {
    return res.status(409).json({ success: false, message: 'This record already exists.' });
  }

  logger.error(err.stack || err);
  res.status(500).json({
    success: false,
    message: env.nodeEnv === 'production' ? 'Something went wrong.' : err.message,
  });
};
