/**
 * Agent 工具注册表
 * ==================================================================
 * 每个工具包含:
 *   - name: OpenAI tool name(snake_case)
 *   - description: 给 LLM 看的说明
 *   - parameters: JSON Schema
 *   - handler: async (args, ctx) => any  真正的执行函数
 *   - safe: 是否安全(true = 免用户确认;false = 需要 UI 二次确认)
 *
 * ctx 里带的东西:
 *   - userId: 当前登录用户 id(int)
 *
 * 所有 handler 都可以直接抛错;runner 会捕获并把 error 字符串给 LLM。
 */

const userRepository = require('../repositories/userRepository');
const jobRepository = require('../repositories/jobRepository');
const jobFavoriteRepository = require('../repositories/jobFavoriteRepository');
const jobApplicationRepository = require('../repositories/jobApplicationRepository');
const jobService = require('./jobService');

// ---------- 具体工具 handler ----------

async function getMyProfile(_args, { userId }) {
  const p = await userRepository.findProfileById(userId);
  if (!p) throw new Error('用户不存在');
  return {
    username: p.username,
    major: p.major,
    college: p.college,
    grade: p.grade,
    career_direction: p.career_direction,
    preferred_city: p.preferred_city,
    interests: p.interests || [],
    bio: p.bio,
  };
}

async function listJobs({ keyword, city, category, workType, degree, salaryMin, limit = 10 } = {}, _ctx) {
  const capped = Math.min(20, Math.max(1, Number(limit) || 10));
  const items = await jobRepository.list({
    keyword, city, category, workType, degree, salaryMin,
    offset: 0, limit: capped,
  });
  // 精简字段,不让 LLM context 爆炸
  return items.map((j) => ({
    id: j.id,
    title: j.title,
    company: j.company,
    city: j.city,
    salary_display: j.salary_display,
    category: j.category,
    work_type: j.work_type,
    degree_required: j.degree_required,
    tags: j.tags,
    apply_count: j.apply_count,
    is_hot: !!j.is_hot,
  }));
}

async function getJobDetail({ id }, _ctx) {
  const job = await jobRepository.findById(Number(id));
  if (!job) throw new Error(`岗位 ${id} 不存在`);
  return {
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
}

async function recommendJobs({ limit = 5 } = {}, { userId }) {
  const capped = Math.min(10, Math.max(1, Number(limit) || 5));
  const items = await jobService.recommend(userId, { limit: capped });
  return items.map((j) => ({
    id: j.id,
    title: j.title,
    company: j.company,
    city: j.city,
    salary_display: j.salary_display,
    category: j.category,
    match_score: j.match_score ?? null,
    tags: j.tags,
  }));
}

async function listMyFavorites(_args, { userId }) {
  const rows = await jobFavoriteRepository.listByUser(userId, { limit: 20 });
  return rows.map((j) => ({
    id: j.id,
    title: j.title,
    company: j.company,
    city: j.city,
    salary_display: j.salary_display,
    category: j.category,
  }));
}

async function listMyApplications(_args, { userId }) {
  const rows = await jobApplicationRepository.listByUser(userId, { limit: 20 });
  return rows.map((a) => ({
    id: a.id,
    job_id: a.job_id,
    title: a.title,
    company: a.company,
    city: a.city,
    salary_display: a.salary_display,
    status: a.status,
    created_at: a.created_at,
    message: a.message,
  }));
}

async function favoriteJob({ id }, { userId }) {
  const result = await jobService.toggleFavorite({ jobId: Number(id), userId });
  return { jobId: Number(id), favorited: result.favorited };
}

async function applyJob({ id, message }, { userId }) {
  if (!message || String(message).length < 10) {
    throw new Error('申请留言至少 10 字,以便 HR 了解你');
  }
  const result = await jobService.applyJob({
    jobId: Number(id), userId, message: String(message).slice(0, 500),
  });
  return { jobId: Number(id), status: result.status };
}

// ---------- OpenAI tools schema ----------

const TOOLS = [
  {
    name: 'get_my_profile',
    description: '读取当前登录用户的个人画像:专业、年级、意向方向、意向城市、兴趣标签等。建议在给用户建议前总是先调这个,否则回答会脱离用户实际。',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: getMyProfile,
    safe: true,
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
  },
  {
    name: 'list_my_favorites',
    description: '拿到当前用户收藏的岗位列表',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: listMyFavorites,
    safe: true,
  },
  {
    name: 'list_my_applications',
    description: '拿到当前用户已投递的岗位以及状态(pending / viewed / interview / offer / rejected / withdrawn)',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: listMyApplications,
    safe: true,
  },
  {
    name: 'favorite_job',
    description: '收藏或取消收藏一个岗位(toggle)。安全操作,可以直接调用,不需要用户额外确认。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
    },
    handler: favoriteJob,
    safe: true,
  },
  {
    name: 'apply_job',
    description: '投递一个岗位。这是不可逆操作,只在用户明确表达"投递""帮我投"等意图时调用。message 是给 HR 看的申请留言(50-300 字最佳)。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        message: { type: 'string', description: '申请留言,至少 10 字' },
      },
      required: ['id', 'message'],
    },
    handler: applyJob,
    safe: false, // 前端可以选择弹二次确认(先不做,当前 demo 直接执行)
  },
];

/** 转换成 OpenAI SDK 期望的 tools 数组格式 */
function toOpenAITools() {
  return TOOLS.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** 按名字取 handler */
function getTool(name) {
  return TOOLS.find((t) => t.name === name) || null;
}

module.exports = { TOOLS, toOpenAITools, getTool };
