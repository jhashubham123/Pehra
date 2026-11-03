// Access tokens (short JWT) and refresh sessions (long random token, stored hashed).
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { query } = require('../db/query');
const { sha256, randomToken } = require('../utils/crypto');
const ApiError = require('../utils/ApiError');

// profile = one role in one society, or null for a person who has no role yet
function signAccessToken(userId, profile) {
  const claims = profile
    ? {
        role: profile.role,
        society_id: profile.society_id,
        profile_id: profile.profile_id,
        gate_id: profile.gate_id || null,
        status: profile.status,
      }
    : { role: 'user', society_id: null, profile_id: null, gate_id: null, status: 'active' };

  return jwt.sign(claims, env.jwtSecret, {
    subject: userId,
    expiresIn: `${env.accessTokenMinutes}m`,
  });
}

function accessTokenResponse(userId, profile) {
  return {
    access_token: signAccessToken(userId, profile),
    token_type: 'Bearer',
    expires_in: env.accessTokenMinutes * 60,
  };
}

async function createSession(userId, meta = {}) {
  const token = randomToken(48);
  await query(
    `insert into auth_sessions (user_id, refresh_token_hash, user_agent, ip, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(days => $5))`,
    [userId, sha256(token), (meta.userAgent || '').slice(0, 300) || null, meta.ip || null, env.refreshTokenDays]
  );
  return token;
}

// A refresh token works once. Using it closes it and hands back a fresh one.
async function rotateSession(oldToken, meta = {}) {
  const { rows } = await query(
    `update auth_sessions set revoked_at = now(), last_used_at = now()
      where refresh_token_hash = $1 and revoked_at is null and expires_at > now()
      returning user_id`,
    [sha256(oldToken)]
  );
  if (!rows[0]) throw new ApiError(401, 'Session expired. Please log in again.');
  const userId = rows[0].user_id;
  const refreshToken = await createSession(userId, meta);
  return { userId, refreshToken };
}

async function revokeSession(token) {
  await query(
    `update auth_sessions set revoked_at = now() where refresh_token_hash = $1 and revoked_at is null`,
    [sha256(token)]
  );
}

module.exports = { accessTokenResponse, createSession, rotateSession, revokeSession };
