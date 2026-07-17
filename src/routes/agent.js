const Router = require('koa-router');
const agentController = require('../controllers/agentController');
const { requireAuth } = require('../middleware/auth');

const router = new Router();

router.use(requireAuth);

router.post('/stream', agentController.stream);
router.get('/history', agentController.history);
router.delete('/history', agentController.clear);

module.exports = router;
