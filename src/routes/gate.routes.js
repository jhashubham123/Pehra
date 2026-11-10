const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const authorizeRole = require('../middlewares/authorizeRole');
const validate = require('../middlewares/validate');
const v = require('../validators/structure.validator');
const gate = require('../controllers/gate.controller');

router.use(authenticate, authorizeRole('admin'));
router.get('/', validate(v.gateList, 'query'), gate.list);
router.post('/', validate(v.gateCreate), gate.create);
router.patch('/:id', validate(v.idParams, 'params'), validate(v.gateUpdate), gate.update);

module.exports = router;
