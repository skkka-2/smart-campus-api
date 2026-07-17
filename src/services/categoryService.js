const categoryRepository = require('../repositories/categoryRepository');

const categoryService = {
  async list() {
    return categoryRepository.list();
  },
};

module.exports = categoryService;
