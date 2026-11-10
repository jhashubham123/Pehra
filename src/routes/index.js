// Combines every route file under /api/v1
const router = require('express').Router();

router.get('/health', (req, res) => res.json({ ok: true, service: 'pehra-api', time: new Date().toISOString() }));
router.use('/auth', require('./auth.routes'));
router.use('/society', require('./society.routes'));
router.use('/towers', require('./tower.routes'));
router.use('/flats', require('./flat.routes'));
router.use('/gates', require('./gate.routes'));
router.use('/residents', require('./resident.routes'));
router.use('/join-requests', require('./joinRequest.routes'));

module.exports = router;
