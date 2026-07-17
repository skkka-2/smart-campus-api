const categoryService = require('../services/categoryService');

const categoryController = {
  async list(ctx) {
    const items = await categoryService.list();
    ctx.success({ items });
  },
};

module.exports = categoryController;
