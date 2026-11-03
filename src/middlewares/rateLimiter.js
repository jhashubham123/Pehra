// Basic abuse protection per IP. (OTP sending also has its own limits in the database.)
// Note: on Vercel each instance counts separately, so this is a soft limit only.
const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const make = (windowMinutes, limit, message) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => env.disableRateLimit,
    message: { success: false, message },
  });

module.exports = {
  general: make(1, 120, 'Too many requests. Please slow down.'),
  otp: make(10, 20, 'Too many OTP attempts. Try again in a few minutes.'),
  pairing: make(15, 10, 'Too many pairing attempts. Try again later.'),
};
