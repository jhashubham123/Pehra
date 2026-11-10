const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const authorizeRole = require('../middlewares/authorizeRole');
const validate = require('../middlewares/validate');
const residentValidator = require('../validators/resident.validator');
const resident = require('../controllers/resident.controller');

router.use(authenticate, authorizeRole('admin'));
router.get('/', validate(residentValidator.list, 'query'), resident.list);
router.get('/:id', validate(residentValidator.idParams, 'params'), resident.get);
router.patch('/:id', validate(residentValidator.idParams, 'params'), validate(residentValidator.update), resident.update);
router.post('/:id/move-out', validate(residentValidator.idParams, 'params'), validate(residentValidator.moveOut), resident.moveOut);

module.exports = router;
