const Router = require('koa-router');
const aiController = require('../controllers/aiController');
const { requireAuth } = require('../middleware/auth');

const router = new Router();

router.use(requireAuth); // 所有 AI 接口都需要登录

router.post('/chat', aiController.chat);
router.get('/history', aiController.history);
router.delete('/history', aiController.clear);

module.exports = router;
