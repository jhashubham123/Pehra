const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const authorizeRole = require('../middlewares/authorizeRole');
const validate = require('../middlewares/validate');
const v = require('../validators/structure.validator');
const tower = require('../controllers/tower.controller');

router.use(authenticate, authorizeRole('admin'));
router.get('/', validate(v.towerList, 'query'), tower.list);
router.post('/', validate(v.towerCreate), tower.create);
router.post('/:id/flats/generate', validate(v.idParams, 'params'), validate(v.generateFlats), tower.generateFlats);
router.patch('/:id', validate(v.idParams, 'params'), validate(v.towerUpdate), tower.update);
router.delete('/:id', validate(v.idParams, 'params'), tower.remove);

module.exports = router;
