const Router = require('koa-router');
const agentController = require('../controllers/agentController');
const { requireAuth } = require('../middleware/auth');

const router = new Router();

router.use(requireAuth);

router.post('/stream', agentController.stream);
router.get('/history', agentController.history);
router.delete('/history', agentController.clear);
router.post('/actions/confirm', agentController.confirmAction);
// P3-2 会话回放
router.get('/sessions', agentController.getSessions);
router.get('/sessions/:sessionId/events', agentController.getSessionEvents);

module.exports = router;
