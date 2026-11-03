// The ONLY place that connects to the database.
const { Pool } = require('pg');
const env = require('../config/env');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.dbSsl ? { rejectUnauthorized: false } : false,
  max: env.dbPoolMax,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => logger.error('Unexpected database error', err.message));

module.exports = pool;
