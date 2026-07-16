const Router = require('koa-router');
const userController = require('../controllers/userController');
const { requireAuth } = require('../middleware/auth');

const router = new Router();

router.post('/register', userController.register);
router.post('/login', userController.login);
router.get('/me', requireAuth, userController.me);

module.exports = router;
