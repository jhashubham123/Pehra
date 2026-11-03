// Combines every route file under /api/v1
const router = require('express').Router();

router.get('/health', (req, res) => res.json({ ok: true, service: 'pehra-api', time: new Date().toISOString() }));
router.use('/auth', require('./auth.routes'));

module.exports = router;
