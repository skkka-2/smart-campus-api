const Router = require('koa-router');
const jobController = require('../controllers/jobController');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = new Router();

// ==== 公开(但可选带 token 拿匹配度和 favorited 标记) ====
router.get('/filter-options', jobController.filterOptions);
router.get('/recommend', optionalAuth, jobController.recommend);

// ⚠️ 顺序:静态 path 在 :id 前
router.get('/my/favorites', requireAuth, jobController.myFavorites);
router.get('/my/applications', requireAuth, jobController.myApplications);

router.get('/', optionalAuth, jobController.list);
router.get('/:id', optionalAuth, jobController.detail);

// ==== 私有 ====
router.post('/:id/favorite', requireAuth, jobController.toggleFavorite);
router.post('/:id/apply', requireAuth, jobController.apply);

module.exports = router;
