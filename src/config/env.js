// Reads environment variables once and checks the important ones exist.
require('dotenv').config();

const required = ['DATABASE_URL', 'JWT_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing environment variable: ${key}. Copy .env.example to .env and fill it in.`);
  }
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),

  databaseUrl: process.env.DATABASE_URL,
  dbSsl: process.env.DB_SSL !== 'false', // Supabase needs SSL; set DB_SSL=false for a local Postgres
  dbPoolMax: Number(process.env.DB_POOL_MAX || 3), // keep small: serverless opens many instances

  jwtSecret: process.env.JWT_SECRET,
  accessTokenMinutes: Number(process.env.ACCESS_TOKEN_MINUTES || 60),
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS || 30),

  otp: {
    provider: process.env.OTP_PROVIDER || 'console', // 'console' = only prints the OTP (testing)
    debugReturn: process.env.OTP_DEBUG_RETURN === 'true', // send OTP back in the response (testing ONLY)
    expiryMinutes: 5,
    resendGapSeconds: Number(process.env.OTP_RESEND_GAP_SECONDS || 30),
    maxPer10Minutes: Number(process.env.OTP_MAX_PER_10_MIN || 5),
  },

  pairingCodeMinutes: 10,
  disableRateLimit: process.env.DISABLE_RATE_LIMIT === 'true', // used by automated tests
};
