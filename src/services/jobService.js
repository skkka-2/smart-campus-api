const jobRepository = require('../repositories/jobRepository');
const jobFavoriteRepository = require('../repositories/jobFavoriteRepository');
const jobApplicationRepository = require('../repositories/jobApplicationRepository');
const userRepository = require('../repositories/userRepository');
const { BizError } = require('../utils/response');

/**
 * 匹配度算法 —— 简单版
 *   - 专业 → 岗位 category:关键词映射打分
 *   - 意向城市:命中 +20
 *   - 兴趣标签 vs 岗位 tags:交集数 * 8(封顶 24)
 *   - 学历(年级)vs 学历要求:命中 +10
 *   - 分数范围 0-100
 *
 * 无画像时返回 null,让前端不显示匹配度徽章。
 */

/** 专业 → 关键词权重 */
const MAJOR_KEYWORDS = {
  '计算机科学与技术': { 前端: 90, 后端: 100, 算法: 85, 数据: 80, 测试: 70 },
  '软件工程':         { 前端: 100, 后端: 90, 算法: 70, 数据: 70, 测试: 80 },
  '人工智能':         { 算法: 100, 数据: 90, 后端: 60 },
  '数据科学与大数据': { 数据: 100, 算法: 85, 后端: 60 },
  '信息安全':         { 后端: 90, 测试: 85, 算法: 60 },
  '电子信息工程':     { 后端: 70, 算法: 60 },
  '通信工程':         { 后端: 70, 算法: 60 },
  '设计学':           { 设计: 100, 产品: 70 },
  '视觉传达设计':     { 设计: 100, 产品: 65 },
  '工业设计':         { 设计: 100, 产品: 65 },
  '数字媒体艺术':     { 设计: 90, 产品: 65 },
  '市场营销':         { 运营: 100, 产品: 70 },
  '广告学':           { 运营: 90, 设计: 60, 产品: 60 },
  '工商管理':         { 运营: 85, 产品: 80 },
  '经济学':           { 数据: 70, 产品: 65, 运营: 60 },
  '金融学':           { 数据: 80, 产品: 60 },
  '统计学':           { 数据: 100, 算法: 80 },
  '数学与应用数学':   { 算法: 90, 数据: 85 },
  '新闻传播学':       { 运营: 90, 产品: 60 },
  '心理学':           { 产品: 80, 运营: 70 },
};

/** 职业方向直接映射到 category */
function scoreDirection(direction, jobCategory) {
  if (!direction) return 0;
  return direction === jobCategory ? 30 : 0;
}

function scoreMajor(major, jobCategory) {
  const keywords = MAJOR_KEYWORDS[major];
  if (!keywords) return 20; // 未收录的专业给个默认分,不完全零
  const weight = keywords[jobCategory];
  // 40 分满,按权重比例给
  return weight ? Math.round((weight / 100) * 40) : 0;
}

function scoreCity(preferredCity, jobCity) {
  if (!preferredCity) return 10; // 无偏好给中间分
  return preferredCity === jobCity ? 20 : 5;
}

function scoreDegree(grade, degreeRequired) {
  if (!grade) return 0;
  if (degreeRequired === '不限') return 10;
  const gradeToDegree = {
    '大一': '本科', '大二': '本科', '大三': '本科', '大四': '本科',
    '研一': '硕士', '研二': '硕士', '研三': '硕士',
  };
  const actual = gradeToDegree[grade];
  if (!actual) return 5;
  if (actual === degreeRequired) return 10;
  if (actual === '硕士' && degreeRequired === '本科') return 10; // 硕士也满足本科要求
  return 3;
}

function scoreInterests(interests, tags) {
  if (!Array.isArray(interests) || !interests.length) return 0;
  if (!Array.isArray(tags) || !tags.length) return 0;
  const set = new Set(tags.map((t) => t.toLowerCase()));
  const hits = interests.filter((i) => set.has(String(i).toLowerCase())).length;
  return Math.min(20, hits * 8);
}

function getInterestHits(interests, tags) {
  if (!Array.isArray(interests) || !Array.isArray(tags)) return [];
  const tagMap = new Map(tags.map((tag) => [String(tag).toLowerCase(), tag]));
  return interests
    .filter((interest) => tagMap.has(String(interest).toLowerCase()))
    .map((interest) => tagMap.get(String(interest).toLowerCase()));
}

/** 综合打分 */
function computeMatchScore(user, job) {
  if (!user || (!user.major && !user.career_direction)) return null;
  const s =
    scoreMajor(user.major, job.category) +
    scoreDirection(user.career_direction, job.category) +
    scoreCity(user.preferred_city, job.city) +
    scoreDegree(user.grade, job.degree_required) +
    scoreInterests(user.interests, job.tags);
  return Math.min(100, Math.max(0, Math.round(s)));
}

function computeMatchExplanation(user, job) {
  if (!user) {
    return {
      match_score: null,
      match_reasons: ['登录并完善画像后可获得个性化匹配理由'],
      match_gaps: ['缺少用户画像,暂时只能按岗位热度推荐'],
    };
  }

  const reasons = [];
  const gaps = [];

  if (user.career_direction && user.career_direction === job.category) {
    reasons.push(`职业方向匹配:${user.career_direction}`);
  } else if (user.career_direction) {
    gaps.push(`意向方向是${user.career_direction},岗位方向是${job.category}`);
  } else {
    gaps.push('画像缺少职业方向');
  }

  const majorScore = scoreMajor(user.major, job.category);
  if (user.major && majorScore > 0) {
    reasons.push(`专业背景相关:${user.major}`);
  } else if (!user.major) {
    gaps.push('画像缺少专业信息');
  }

  if (user.preferred_city && user.preferred_city === job.city) {
    reasons.push(`意向城市匹配:${job.city}`);
  } else if (user.preferred_city) {
    gaps.push(`意向城市是${user.preferred_city},岗位城市是${job.city}`);
  }

  const interestHits = getInterestHits(user.interests, job.tags);
  if (interestHits.length) {
    reasons.push(`兴趣/技能标签命中:${interestHits.slice(0, 3).join(' / ')}`);
  } else if (Array.isArray(job.tags) && job.tags.length) {
    gaps.push(`岗位需要${job.tags.slice(0, 3).join(' / ')},画像标签暂未体现`);
  }

  const degreeScore = scoreDegree(user.grade, job.degree_required);
  if (user.grade && degreeScore >= 10) {
    reasons.push(`学历/年级满足要求:${job.degree_required}`);
  } else if (!user.grade) {
    gaps.push('画像缺少年级信息');
  }

  if (!reasons.length) {
    reasons.push('岗位热度和基础条件较优,可作为备选关注');
  }

  return {
    match_score: computeMatchScore(user, job),
    match_reasons: reasons,
    match_gaps: gaps,
  };
}

const jobService = {
  async listJobs({ filters, offset, limit, page, userId } = {}) {
    const [items, total] = await Promise.all([
      jobRepository.list({ ...filters, offset, limit }),
      jobRepository.count(filters),
    ]);

    let user = null;
    let favoriteIds = new Set();
    let applications = new Map();
    if (userId) {
      const jobIds = items.map((j) => j.id);
      [user, favoriteIds, applications] = await Promise.all([
        userRepository.findProfileById(userId),
        jobFavoriteRepository.listUserFavoriteIds(userId, jobIds),
        jobApplicationRepository.listUserApplicationIds(userId, jobIds),
      ]);
    }

    const enriched = items.map((job) => ({
      ...job,
      ...computeMatchExplanation(user, job),
      favorited: favoriteIds.has(job.id),
      applied: applications.get(job.id) || null,
    }));

    return {
      items: enriched,
      page,
      limit,
      total,
      hasMore: offset + items.length < total,
    };
  },

  async getJobDetail({ id, userId } = {}) {
    const job = await jobRepository.findById(id);
    if (!job) throw BizError.notFound('岗位不存在或已下线');

    // async view++
    jobRepository.incrementView(id).catch(() => {});

    let user = null;
    let favorited = false;
    let applied = null;
    if (userId) {
      user = await userRepository.findProfileById(userId);
      favorited = await jobFavoriteRepository.exists({ jobId: id, userId });
      const app = await jobApplicationRepository.exists({ jobId: id, userId });
      applied = app ? app.status : null;
    }

    // 相似岗位
    const similar = await jobRepository.recommendForUser({
      category: job.category,
      city: job.city,
      limit: 5,
    });

    return {
      job: {
        ...job,
        ...computeMatchExplanation(user, job),
        favorited,
        applied,
      },
      similar: similar.filter((s) => s.id !== job.id).slice(0, 4),
    };
  },

  async toggleFavorite({ jobId, userId } = {}) {
    if (!userId) throw BizError.unauthorized('请先登录');
    const job = await jobRepository.findById(jobId);
    if (!job) throw BizError.notFound('岗位不存在');

    const already = await jobFavoriteRepository.exists({ jobId, userId });
    if (already) {
      await jobFavoriteRepository.remove({ jobId, userId });
    } else {
      await jobFavoriteRepository.create({ jobId, userId });
    }
    return { favorited: !already };
  },

  async applyJob({ jobId, userId, message } = {}) {
    if (!userId) throw BizError.unauthorized('请先登录');
    const job = await jobRepository.findById(jobId);
    if (!job) throw BizError.notFound('岗位不存在');

    const existing = await jobApplicationRepository.exists({ jobId, userId });
    if (existing) throw BizError.conflict('你已经投递过这个岗位了');

    await jobApplicationRepository.create({ jobId, userId, message });
    jobRepository.incrementApply(jobId).catch(() => {});
    return { status: 'pending' };
  },

  /** 我的收藏 */
  async myFavorites(userId, { offset, limit } = {}) {
    return jobFavoriteRepository.listByUser(userId, { offset, limit });
  },

  /** 我的投递 */
  async myApplications(userId, { offset, limit } = {}) {
    return jobApplicationRepository.listByUser(userId, { offset, limit });
  },

  /** 为你推荐 —— 基于画像 */
  async recommend(userId, { limit = 6 } = {}) {
    // 修复：之前 findProfileById 查了两次（273 和 280），复用一次的结果。
    // 返回值不变（仍是数组），保证 /api/jobs/recommend 不被破坏。
    let user = null;
    let category = null;
    let city = null;
    if (userId) {
      user = await userRepository.findProfileById(userId);
      category = user?.career_direction || null;
      city = user?.preferred_city || null;
    }
    const items = await jobRepository.recommendForUser({ category, city, limit });

    if (user) {
      return items.map((job) => ({
        ...job,
        ...computeMatchExplanation(user, job),
      }));
    }
    return items.map((job) => ({
      ...job,
      ...computeMatchExplanation(null, job),
    }));
  },

  /**
   * 供 agent 工具使用：推荐的同时返回用到的画像字段。
   * 不改 recommend 的对外返回值（它被 /api/jobs/recommend 直接用）。
   * 学自 openclaw 的 "tool result is prompt, not a bare ack"：
   *   把模型下一步需要的画像一起返回，省掉模型再调 get_my_profile 的一整轮往返。
   */
  async recommendWithProfile(userId, { limit = 6 } = {}) {
    const items = await this.recommend(userId, { limit });
    const profile = userId
      ? await userRepository.findProfileById(userId)
      : null;
    return { items, profile };
  },

  /** 筛选选项 */
  async filterOptions() {
    return jobRepository.filterOptions();
  },
};

module.exports = jobService;
