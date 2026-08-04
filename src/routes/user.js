const Router = require('koa-router');
const userController = require('../controllers/userController');
const { requireAuth } = require('../middleware/auth');

const router = new Router();

router.post('/register', userController.register);
router.post('/login', userController.login);
router.post('/refresh', userController.refresh);
router.post('/logout', userController.logout);
router.post('/me/password', requireAuth, userController.changePassword);
router.get('/me', requireAuth, userController.me);
router.get('/me/profile', requireAuth, userController.getProfile);
router.put('/me/profile', requireAuth, userController.updateProfile);
router.post('/me/avatar', requireAuth, userController.avatarUpload, userController.uploadAvatar);

module.exports = router;
