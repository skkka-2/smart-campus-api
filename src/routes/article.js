const Router = require('koa-router');
const articleController = require('../controllers/articleController');
const { requireAuth } = require('../middleware/auth');

const router = new Router();

// 公开:任何人可看
router.get('/', articleController.list);
router.get('/rankings', articleController.rankings);

// 私有:登录后才能发文
router.post('/', requireAuth, articleController.create);

module.exports = router;
