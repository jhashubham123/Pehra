const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const authorizeRole = require('../middlewares/authorizeRole');
const validate = require('../middlewares/validate');
const staffValidator = require('../validators/staff.validator');
const staff = require('../controllers/staff.controller');

router.use(authenticate, authorizeRole('admin'));
router.get('/', validate(staffValidator.list, 'query'), staff.list);
router.post('/', validate(staffValidator.create), staff.create);
router.get('/:id', validate(staffValidator.idParams, 'params'), staff.get);
router.patch('/:id', validate(staffValidator.idParams, 'params'), validate(staffValidator.update), staff.update);
router.delete('/:id', validate(staffValidator.idParams, 'params'), staff.remove);

module.exports = router;
