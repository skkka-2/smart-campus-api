const Router = require('koa-router');
const userRoutes = require('./user');
const articleRoutes = require('./article');
const commentRoutes = require('./comment');
const aiRoutes = require('./ai');
const chatRoutes = require('./chat');

const router = new Router({ prefix: '/api' });

router.get('/health', (ctx) => ctx.success({ status: 'ok', ts: Date.now() }));

router.use('/users', userRoutes.routes(), userRoutes.allowedMethods());
router.use('/articles', articleRoutes.routes(), articleRoutes.allowedMethods());
router.use('/comments', commentRoutes.routes(), commentRoutes.allowedMethods());
router.use('/ai', aiRoutes.routes(), aiRoutes.allowedMethods());
router.use('/chat', chatRoutes.routes(), chatRoutes.allowedMethods());

module.exports = router;
