// Builds the Express app. server.js (local) and api/index.js (Vercel) both use this.
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const env = require('./config/env');
const limiter = require('./middlewares/rateLimiter');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

app.set('trust proxy', 1); // we sit behind Vercel's proxy, so req.ip is the real caller
app.use(helmet());
app.use(cors()); // tighten to your admin web origin later; the mobile app does not need CORS
app.use(express.json({ limit: '100kb' }));
if (env.nodeEnv !== 'test') app.use(morgan('tiny'));
app.use(limiter.general);

app.get('/', (req, res) => res.json({ name: 'Pehra API', status: 'running', docs: '/api/v1/health' }));
app.use('/api/v1', require('./routes'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
