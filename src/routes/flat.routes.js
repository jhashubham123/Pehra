const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const authorizeRole = require('../middlewares/authorizeRole');
const validate = require('../middlewares/validate');
const v = require('../validators/structure.validator');
const residentValidator = require('../validators/resident.validator');
const flat = require('../controllers/flat.controller');

router.use(authenticate, authorizeRole('admin'));
router.get('/', validate(v.flatList, 'query'), flat.list);
router.post('/', validate(v.flatCreate), flat.create);
router.post('/:flatId/family', validate(v.flatParams, 'params'), validate(residentValidator.family), flat.registerFamily);
router.patch('/:id', validate(v.idParams, 'params'), validate(v.flatUpdate), flat.update);
router.delete('/:id', validate(v.idParams, 'params'), flat.remove);

module.exports = router;
