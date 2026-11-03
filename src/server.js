// Starts the API on your own computer: npm run dev
const env = require('./config/env');
const app = require('./app');

app.listen(env.port, () => console.log(`Pehra API running on http://localhost:${env.port}`));
