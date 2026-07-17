const Router = require('koa-router');
const categoryController = require('../controllers/categoryController');

const router = new Router();

router.get('/', categoryController.list);

module.exports = router;
