// Hashing and random helpers. We store only hashes of OTPs, refresh tokens and pairing codes.
const crypto = require('crypto');
const env = require('../config/env');

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// keyed hash: useless to an attacker who only has a copy of the database
const hmac = (text) => crypto.createHmac('sha256', env.jwtSecret).update(text).digest('hex');

const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');

// random digits like "048213" (leading zeros kept)
const randomDigits = (length) =>
  Array.from({ length }, () => crypto.randomInt(0, 10)).join('');

const safeEqual = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

module.exports = { sha256, hmac, randomToken, randomDigits, safeEqual };
