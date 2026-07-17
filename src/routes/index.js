const Router = require('koa-router');
const userRoutes = require('./user');
const articleRoutes = require('./article');
const categoryRoutes = require('./category');
const commentRoutes = require('./comment');
const aiRoutes = require('./ai');
const chatRoutes = require('./chat');
const jobRoutes = require('./job');
const agentRoutes = require('./agent');

const router = new Router({ prefix: '/api' });

router.get('/health', (ctx) => ctx.success({ status: 'ok', ts: Date.now() }));

router.use('/users', userRoutes.routes(), userRoutes.allowedMethods());
router.use('/articles', articleRoutes.routes(), articleRoutes.allowedMethods());
router.use('/categories', categoryRoutes.routes(), categoryRoutes.allowedMethods());
router.use('/comments', commentRoutes.routes(), commentRoutes.allowedMethods());
router.use('/ai', aiRoutes.routes(), aiRoutes.allowedMethods());
router.use('/chat', chatRoutes.routes(), chatRoutes.allowedMethods());
router.use('/jobs', jobRoutes.routes(), jobRoutes.allowedMethods());
router.use('/agent', agentRoutes.routes(), agentRoutes.allowedMethods());

module.exports = router;
