const Router = require('koa-router');
const commentController = require('../controllers/commentController');
const { requireAuth } = require('../middleware/auth');

const router = new Router();

router.get('/', commentController.list);
router.post('/query', commentController.listByUsername);
router.post('/', requireAuth, commentController.create);

module.exports = router;
