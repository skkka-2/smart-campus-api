const userRepository = require('../repositories/userRepository');
const jobRepository = require('../repositories/jobRepository');
const jobFavoriteRepository = require('../repositories/jobFavoriteRepository');
const jobApplicationRepository = require('../repositories/jobApplicationRepository');
const jobService = require('../services/jobService');
const safetyPolicy = require('./safetyPolicy');

function toolOk(data, { title, summary } = {}) {
  return {
    ok: true,
    data,
    display: {
      title: title || '工具执行完成',
      summary: summary || summarizeData(data),
    },
  };
}

function summarizeData(data) {
  if (Array.isArray(data)) return `返回 ${data.length} 条结果`;
  if (data && typeof data === 'object') return '返回 1 条结果';
  return '执行完成';
}

function unwrapToolData(result) {
  return result?.ok && Object.prototype.hasOwnProperty.call(result, 'data')
    ? result.data
    : result;
}

async function getMyProfile(_args, { userId }) {
  const profile = await userRepository.findProfileById(userId);
  if (!profile) throw new Error('用户不存在');
  const data = {
    username: profile.username,
    major: profile.major,
    college: profile.college,
    grade: profile.grade,
    career_direction: profile.career_direction,
    preferred_city: profile.preferred_city,
    interests: profile.interests || [],
    bio: profile.bio,
  };
  return toolOk(data, {
    title: '读取你的画像',
    summary: data.career_direction || data.major
      ? `已读取画像:${data.major || '未填专业'} / ${data.career_direction || '未填方向'}`
      : '已读取画像,但信息还不完整',
  });
}

async function listJobs({ keyword, city, category, workType, degree, salaryMin, limit = 10 } = {}) {
  const capped = Math.min(20, Math.max(1, Number(limit) || 10));
  const items = await jobRepository.list({
    keyword,
    city,
    category,
    workType,
    degree,
    salaryMin,
    offset: 0,
    limit: capped,
  });
  const data = items.map((job) => ({
    id: job.id,
    title: job.title,
    company: job.company,
    city: job.city,
    salary_display: job.salary_display,
    category: job.category,
    work_type: job.work_type,
    degree_required: job.degree_required,
    tags: job.tags,
    apply_count: job.apply_count,
    is_hot: !!job.is_hot,
  }));
  return toolOk(data, {
    title: '搜索岗位库',
    summary: `找到 ${data.length} 个岗位`,
  });
}

async function getJobDetail({ id }) {
  const job = await jobRepository.findById(Number(id));
  if (!job) throw new Error(`岗位 ${id} 不存在`);
  const data = {
    id: job.id,
    title: job.title,
    company: job.company,
    city: job.city,
    salary_display: job.salary_display,
    category: job.category,
    work_type: job.work_type,
    degree_required: job.degree_required,
    experience_required: job.experience_required,
    description: job.description,
    requirements: job.requirements,
    benefits: job.benefits,
    tags: job.tags,
    apply_count: job.apply_count,
    view_count: job.view_count,
  };
  return toolOk(data, {
    title: '拉取岗位详情',
    summary: `已读取 ${job.company} · ${job.title}`,
  });
}

async function recommendJobs({ limit = 5 } = {}, { userId }) {
  const capped = Math.min(10, Math.max(1, Number(limit) || 5));
  const items = await jobService.recommend(userId, { limit: capped });
  const data = items.map((job) => ({
    id: job.id,
    title: job.title,
    company: job.company,
    city: job.city,
    salary_display: job.salary_display,
    category: job.category,
    match_score: job.match_score ?? null,
    match_reasons: job.match_reasons || [],
    match_gaps: job.match_gaps || [],
    tags: job.tags,
  }));
  return toolOk(data, {
    title: '基于画像推荐',
    summary: `推荐 ${data.length} 个匹配岗位`,
  });
}

async function listMyFavorites(_args, { userId }) {
  const rows = await jobFavoriteRepository.listByUser(userId, { limit: 20 });
  const data = rows.map((job) => ({
    id: job.id,
    title: job.title,
    company: job.company,
    city: job.city,
    salary_display: job.salary_display,
    category: job.category,
  }));
  return toolOk(data, {
    title: '读取收藏列表',
    summary: `你收藏了 ${data.length} 个岗位`,
  });
}

async function listMyApplications(_args, { userId }) {
  const rows = await jobApplicationRepository.listByUser(userId, { limit: 20 });
  const data = rows.map((application) => ({
    id: application.id,
    job_id: application.job_id,
    title: application.title,
    company: application.company,
    city: application.city,
    salary_display: application.salary_display,
    status: application.status,
    created_at: application.created_at,
    message: application.message,
  }));
  return toolOk(data, {
    title: '读取投递记录',
    summary: `你投递了 ${data.length} 个岗位`,
  });
}

async function favoriteJob({ id }, { userId }) {
  const result = await jobService.toggleFavorite({ jobId: Number(id), userId });
  const data = { jobId: Number(id), favorited: result.favorited };
  return toolOk(data, {
    title: '收藏岗位',
    summary: result.favorited ? '已收藏岗位' : '已取消收藏岗位',
  });
}

async function applyJob({ id, message }, { userId }) {
  // message 的长度约束已收敛到 schema（minLength:10 / maxLength:500），
  // 这里不再手写检查。id 已由 schema 保证是 integer。
  const result = await jobService.applyJob({
    jobId: Number(id),
    userId,
    message,
  });
  const data = { jobId: Number(id), status: result.status };
  return toolOk(data, {
    title: '提交投递',
    summary: `投递状态:${result.status}`,
  });
}

const TOOLS = [
  {
    name: 'get_my_profile',
    description: '读取当前登录用户的个人画像:专业、年级、意向方向、意向城市、兴趣标签等。建议在给用户建议前总是先调这个,否则回答会脱离用户实际。',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: getMyProfile,
    safe: true,
    requiresConfirmation: false,
  },
  {
    name: 'list_jobs',
    description: '按条件搜索岗位池。返回精简字段列表(id/title/company/city/salary/category 等)。要看某个岗位的完整描述/要求/福利,再调 get_job_detail。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '标题或公司关键词(如 "字节"/"前端")' },
        city: { type: 'string', description: '如 "北京"/"上海"/"深圳" 等' },
        category: {
          type: 'string',
          enum: ['前端', '后端', '算法', '产品', '设计', '运营', '数据', '测试'],
          description: '岗位方向',
        },
        workType: {
          type: 'string',
          enum: ['internship', 'campus', 'social'],
          description: '实习(internship) / 校招(campus) / 社招(social)',
        },
        degree: {
          type: 'string',
          enum: ['专科', '本科', '硕士', '博士', '不限'],
        },
        salaryMin: { type: 'number', description: '最低薪资;实习为 元/天,校招为 元/月' },
        limit: { type: 'integer', description: '返回条数上限,默认 10,最大 20' },
      },
    },
    handler: listJobs,
    safe: true,
    requiresConfirmation: false,
  },
  {
    name: 'get_job_detail',
    description: '拿一个岗位的完整详情(描述、要求列表、福利、标签)。id 从 list_jobs 或 recommend_jobs 的返回中来。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
    },
    handler: getJobDetail,
    safe: true,
    requiresConfirmation: false,
  },
  {
    name: 'recommend_jobs',
    description: '基于当前用户画像做智能推荐,返回带匹配度分数的岗位列表。用户问"最适合我的"、"推荐几个"时优先用这个。',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: '默认 5,最大 10' } },
    },
    handler: recommendJobs,
    safe: true,
    requiresConfirmation: false,
  },
  {
    name: 'list_my_favorites',
    description: '拿到当前用户收藏的岗位列表',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: listMyFavorites,
    safe: true,
    requiresConfirmation: false,
  },
  {
    name: 'list_my_applications',
    description: '拿到当前用户已投递的岗位以及状态(pending / viewed / interview / offer / rejected / withdrawn)',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: listMyApplications,
    safe: true,
    requiresConfirmation: false,
  },
  {
    name: 'favorite_job',
    description: '收藏或取消收藏一个岗位(toggle)。低风险写操作,可以直接调用,不需要用户额外确认。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
    },
    handler: favoriteJob,
    safe: true,
    requiresConfirmation: false,
  },
  {
    name: 'apply_job',
    description: '投递一个岗位。这是不可逆操作,只在用户明确表达"投递""帮我投"等意图时调用。message 是给 HR 看的申请留言(50-300 字最佳)。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        message: { type: 'string', description: '申请留言,至少 10 字', minLength: 10, maxLength: 500 },
      },
      required: ['id', 'message'],
      additionalProperties: false,
    },
    handler: applyJob,
    safe: false,
    requiresConfirmation: true,
  },
];

function getToolsSchema() {
  return TOOLS.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function toOpenAITools() {
  return getToolsSchema();
}

function getToolDefinition(name) {
  return TOOLS.find((tool) => tool.name === name) || null;
}

function getToolHandler(name) {
  return getToolDefinition(name)?.handler || null;
}

function getTool(name) {
  return getToolDefinition(name);
}

function requiresConfirmation(name, args) {
  const tool = getToolDefinition(name);
  return !!tool?.requiresConfirmation || safetyPolicy.requiresConfirmation(name, args);
}

module.exports = {
  TOOLS,
  getToolsSchema,
  toOpenAITools,
  getToolDefinition,
  getToolHandler,
  getTool,
  requiresConfirmation,
  toolOk,
  unwrapToolData,
};
