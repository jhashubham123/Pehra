const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const authorizeRole = require('../middlewares/authorizeRole');
const validate = require('../middlewares/validate');
const residentValidator = require('../validators/resident.validator');
const joinRequest = require('../controllers/joinRequest.controller');

router.use(authenticate, authorizeRole('admin'));
router.get('/', validate(residentValidator.joinRequestList, 'query'), joinRequest.list);
router.post('/:id/approve', validate(residentValidator.idParams, 'params'), validate(residentValidator.approve), joinRequest.approve);
router.post('/:id/decline', validate(residentValidator.idParams, 'params'), validate(residentValidator.decline), joinRequest.decline);

module.exports = router;
