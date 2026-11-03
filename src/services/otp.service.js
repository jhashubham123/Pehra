// Creates, sends and checks one-time passwords. Only a hash of the OTP is stored.
const env = require('../config/env');
const { query } = require('../db/query');
const { sha256, randomDigits, safeEqual } = require('../utils/crypto');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

const hashOtp = (phone, otp) => sha256(`${phone}:${otp}:${env.jwtSecret}`);

// Real SMS goes here later (MSG91 or similar, with DLT-approved template).
async function sendSms(phone, otp) {
  if (env.otp.provider === 'console') {
    logger.info(`[OTP:console] ${phone} -> ${otp}`);
    return;
  }
  throw new ApiError(500, `OTP provider "${env.otp.provider}" is not set up yet.`);
}

async function requestOtp(phone, ip) {
  const { rows } = await query(
    `select count(*)::int as sent,
            coalesce(extract(epoch from (now() - max(created_at))), 9999) as seconds_since_last
       from otp_requests
      where phone = $1 and created_at > now() - interval '10 minutes'`,
    [phone]
  );
  const { sent, seconds_since_last: sinceLast } = rows[0];

  if (sent >= env.otp.maxPer10Minutes) {
    throw new ApiError(429, 'Too many OTP requests. Try again in 10 minutes.');
  }
  if (Number(sinceLast) < env.otp.resendGapSeconds) {
    const wait = Math.ceil(env.otp.resendGapSeconds - Number(sinceLast));
    throw new ApiError(429, `Please wait ${wait} seconds before asking for a new OTP.`);
  }

  const otp = randomDigits(6);
  await query(
    `insert into otp_requests (phone, code_hash, expires_at, request_ip)
     values ($1, $2, now() + make_interval(mins => $3), $4)`,
    [phone, hashOtp(phone, otp), env.otp.expiryMinutes, ip || null]
  );

  await sendSms(phone, otp);

  const result = {
    expires_in_seconds: env.otp.expiryMinutes * 60,
    resend_after_seconds: env.otp.resendGapSeconds,
  };
  if (env.otp.debugReturn) result.dev_otp = otp; // TESTING ONLY: never enable in production
  return result;
}

// Throws if the OTP is wrong. Returns nothing when it is right.
async function verifyOtp(phone, otp) {
  const { rows } = await query(
    `select id, code_hash from otp_requests
      where phone = $1 and consumed_at is null and expires_at > now()
      order by created_at desc limit 1`,
    [phone]
  );
  const record = rows[0];
  if (!record) throw new ApiError(400, 'OTP expired or not requested. Please ask for a new one.');

  // count this try first; refuse when tries are used up
  const tried = await query(
    `update otp_requests set attempts = attempts + 1
      where id = $1 and attempts < max_attempts
      returning attempts, max_attempts`,
    [record.id]
  );
  if (!tried.rows[0]) throw new ApiError(429, 'Too many wrong attempts. Please ask for a new OTP.');

  if (!safeEqual(record.code_hash, hashOtp(phone, otp))) {
    const left = tried.rows[0].max_attempts - tried.rows[0].attempts;
    throw new ApiError(400, `Wrong OTP. ${left} attempt${left === 1 ? '' : 's'} left.`);
  }

  const used = await query(
    `update otp_requests set consumed_at = now() where id = $1 and consumed_at is null returning id`,
    [record.id]
  );
  if (!used.rows[0]) throw new ApiError(400, 'This OTP was already used.');
}

module.exports = { requestOtp, verifyOtp };
