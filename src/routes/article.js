const Router = require('koa-router');
const articleController = require('../controllers/articleController');
const commentController = require('../controllers/commentController');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = new Router();

// ==== 公开 ====
router.get('/rankings', articleController.rankings);
router.get('/', articleController.list);

// optionalAuth:未登录可看,已登录可拿到 liked 标记
router.get('/:id', optionalAuth, articleController.detail);
router.get('/:articleId/comments', commentController.listByArticle);

// ==== 需要登录 ====
router.post('/', requireAuth, articleController.create);
router.post('/:id/like', requireAuth, articleController.toggleLike);
router.post('/:articleId/comments', requireAuth, commentController.createOnArticle);

module.exports = router;
