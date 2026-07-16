const Router = require('koa-router');
const chatController = require('../controllers/chatController');

const router = new Router();

router.get('/history', chatController.history);

module.exports = router;
