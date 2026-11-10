const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const authorizeRole = require('../middlewares/authorizeRole');
const validate = require('../middlewares/validate');
const v = require('../validators/society.validator');
const society = require('../controllers/society.controller');

router.use(authenticate, authorizeRole('admin'));
router.get('/', society.get);
router.patch('/', validate(v.update), society.update);
router.post('/invite-code/rotate', society.rotateInviteCode);

module.exports = router;
