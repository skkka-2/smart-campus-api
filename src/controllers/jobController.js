const jobService = require('../services/jobService');
const { parsePagination } = require('../utils/pagination');
const { BizError } = require('../utils/response');

const jobController = {
  /** GET /api/jobs?keyword=&city=&category=&workType=&degree=&salaryMin=&sort=&page=&limit= */
  async list(ctx) {
    const { page, limit, offset } = parsePagination(ctx.query, 10);
    const filters = {
      keyword: ctx.query.keyword || undefined,
      city: ctx.query.city || undefined,
      category: ctx.query.category || undefined,
      workType: ctx.query.workType || undefined,
      degree: ctx.query.degree || undefined,
      salaryMin: ctx.query.salaryMin || undefined,
      sort: ctx.query.sort || 'default',
    };
    const data = await jobService.listJobs({
      filters, page, limit, offset,
      userId: ctx.state.user?.id,
    });
    ctx.success(data);
  },

  /** GET /api/jobs/filter-options */
  async filterOptions(ctx) {
    const data = await jobService.filterOptions();
    ctx.success(data);
  },

  /** GET /api/jobs/recommend?limit=6 */
  async recommend(ctx) {
    const limit = Math.min(20, Math.max(1, Number.parseInt(ctx.query.limit, 10) || 6));
    const items = await jobService.recommend(ctx.state.user?.id, { limit });
    ctx.success({ items });
  },

  /** GET /api/jobs/my/favorites */
  async myFavorites(ctx) {
    const { offset, limit } = parsePagination(ctx.query, 20);
    const items = await jobService.myFavorites(ctx.state.user.id, { offset, limit });
    ctx.success({ items });
  },

  /** GET /api/jobs/my/applications */
  async myApplications(ctx) {
    const { offset, limit } = parsePagination(ctx.query, 20);
    const items = await jobService.myApplications(ctx.state.user.id, { offset, limit });
    ctx.success({ items });
  },

  /** GET /api/jobs/:id */
  async detail(ctx) {
    const id = Number(ctx.params.id);
    if (!Number.isFinite(id)) throw BizError.badRequest('无效的岗位 id');
    const data = await jobService.getJobDetail({ id, userId: ctx.state.user?.id });
    ctx.success(data);
  },

  /** POST /api/jobs/:id/favorite */
  async toggleFavorite(ctx) {
    const jobId = Number(ctx.params.id);
    if (!Number.isFinite(jobId)) throw BizError.badRequest('无效的岗位 id');
    const data = await jobService.toggleFavorite({ jobId, userId: ctx.state.user.id });
    ctx.success(data);
  },

  /** POST /api/jobs/:id/apply body: { message } */
  async apply(ctx) {
    const jobId = Number(ctx.params.id);
    if (!Number.isFinite(jobId)) throw BizError.badRequest('无效的岗位 id');
    const { message } = ctx.request.body || {};
    const data = await jobService.applyJob({ jobId, userId: ctx.state.user.id, message });
    ctx.success(data, '投递成功');
  },
};

module.exports = jobController;
