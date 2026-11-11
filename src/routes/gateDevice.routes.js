const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const authorizeRole = require('../middlewares/authorizeRole');
const validate = require('../middlewares/validate');
const staffValidator = require('../validators/staff.validator');
const staff = require('../controllers/staff.controller');

router.use(authenticate, authorizeRole('admin'));
router.get('/', validate(staffValidator.gateDeviceList, 'query'), staff.listGateDevices);
router.post('/:id/revoke', validate(staffValidator.idParams, 'params'), staff.revokeGateDevice);

module.exports = router;
