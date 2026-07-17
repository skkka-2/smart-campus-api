const Router = require('koa-router');
const userController = require('../controllers/userController');
const { requireAuth } = require('../middleware/auth');

const router = new Router();

router.post('/register', userController.register);
router.post('/login', userController.login);
router.get('/me', requireAuth, userController.me);
router.get('/me/profile', requireAuth, userController.getProfile);
router.put('/me/profile', requireAuth, userController.updateProfile);

module.exports = router;
