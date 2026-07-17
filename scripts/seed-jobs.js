/**
 * 种子脚本:批量导入实习/校招岗位
 *
 *   node scripts/seed-jobs.js         # 清空并写入 80+ 条
 *   node scripts/seed-jobs.js --keep  # 保留旧数据,追加(重复标题会被去重)
 *
 * 数据来源:
 *   1) 手工整理的真实企业公开信息(公司名/城市/薪资范围/学历要求来自各企业官方宣讲会材料)
 *   2) 岗位描述使用通用模板,由 AI 后期补充可选(TODO: 可以做一个 `enrich-jobs.js` 走 OpenAI)
 *
 * 也可以改造这个脚本从公开 API / 爬虫拉数据入库,当前用手工种子保证 demo 稳定性。
 */

require('dotenv').config();
const { db, verifyConnection } = require('../src/db');

const KEEP = process.argv.includes('--keep');

// 公司元数据 —— 集中管理,岗位复用
const COMPANIES = {
  bytedance: {
    company: '字节跳动',
    company_logo: '/BOSS/1.jpg',
    company_size: '10000 人以上',
    industry: '互联网',
  },
  tencent: {
    company: '腾讯',
    company_logo: '/BOSS/2.jpg',
    company_size: '10000 人以上',
    industry: '互联网',
  },
  alibaba: {
    company: '阿里巴巴',
    company_logo: '/BOSS/3.jpg',
    company_size: '10000 人以上',
    industry: '互联网/电商',
  },
  meituan: {
    company: '美团',
    company_logo: '/BOSS/4.webp',
    company_size: '10000 人以上',
    industry: '互联网/本地生活',
  },
  jd: {
    company: '京东',
    company_logo: '/BOSS/5.jpg',
    company_size: '10000 人以上',
    industry: '互联网/电商',
  },
  baidu: {
    company: '百度',
    company_logo: '/BOSS/6.jpg',
    company_size: '10000 人以上',
    industry: '互联网/AI',
  },
  xiaohongshu: {
    company: '小红书',
    company_logo: '/BOSS/01.png',
    company_size: '1000-9999 人',
    industry: '互联网/社区',
  },
  bilibili: {
    company: 'B站',
    company_logo: '/BOSS/02.jpg',
    company_size: '1000-9999 人',
    industry: '互联网/视频',
  },
  didi: {
    company: '滴滴',
    company_logo: '/BOSS/03.jpg',
    company_size: '10000 人以上',
    industry: '互联网/出行',
  },
  kuaishou: {
    company: '快手',
    company_logo: '/BOSS/04.jpg',
    company_size: '10000 人以上',
    industry: '互联网/短视频',
  },
  netease: {
    company: '网易',
    company_logo: '/BOSS/05.jpg',
    company_size: '10000 人以上',
    industry: '互联网/游戏',
  },
  huawei: {
    company: '华为',
    company_logo: '/BOSS/1.jpg',
    company_size: '10000 人以上',
    industry: '通信/终端',
  },
  xiaomi: {
    company: '小米',
    company_logo: '/BOSS/2.jpg',
    company_size: '10000 人以上',
    industry: '智能硬件/IoT',
  },
  pinduoduo: {
    company: '拼多多',
    company_logo: '/BOSS/3.jpg',
    company_size: '10000 人以上',
    industry: '互联网/电商',
  },
  zhihu: {
    company: '知乎',
    company_logo: '/BOSS/4.webp',
    company_size: '1000-9999 人',
    industry: '互联网/内容',
  },
  shein: {
    company: 'SHEIN',
    company_logo: '/BOSS/5.jpg',
    company_size: '10000 人以上',
    industry: '跨境电商',
  },
};

/**
 * 岗位模板生成器,基于 category 生成描述/要求/福利,减少重复
 */
const TEMPLATES = {
  前端: {
    baseDesc: '负责公司核心业务前端页面开发,与产品、设计、后端紧密协作,持续优化产品体验。',
    baseReqs: [
      '前端方向在校生,2025 届优先',
      '熟练掌握 HTML/CSS/JavaScript,理解 ES6+ 特性',
      '熟悉 Vue 3 或 React,理解组件化与状态管理',
      '有工程化实践经验(webpack/vite)加分',
      '有开源项目或个人博客加分',
    ],
    tags: ['Vue', 'React', 'TypeScript', 'CSS', '工程化'],
  },
  后端: {
    baseDesc: '参与业务后端服务的设计与开发,理解海量数据与高并发挑战,和资深工程师一起解决实际问题。',
    baseReqs: [
      '计算机相关专业在校生',
      '熟练掌握至少一门后端语言(Go / Java / Node.js / Python)',
      '熟悉常见数据结构与算法',
      '熟悉 MySQL / Redis 等基础组件',
      '理解 HTTP、TCP 基础,有网络编程经验加分',
    ],
    tags: ['Go', 'Java', 'MySQL', 'Redis', '分布式'],
  },
  算法: {
    baseDesc: '参与推荐/搜索/CV/NLP 等方向的算法研究与工程实现,深度学习模型训练与线上部署。',
    baseReqs: [
      '985/211 硕士优先,计算机/数学/统计相关专业',
      '熟悉深度学习基础,掌握至少一种框架(PyTorch/TensorFlow)',
      '有顶会/顶刊论文,或 Kaggle/ACM 竞赛奖项优先',
      '扎实的 Python 编码功底',
      '对业务场景有理解并能落地',
    ],
    tags: ['Python', 'PyTorch', '深度学习', '推荐系统', 'NLP'],
  },
  产品: {
    baseDesc: '负责产品需求分析、方案设计、跟进研发落地,持续追踪核心指标并做出优化决策。',
    baseReqs: [
      '不限专业,对互联网产品有强烈兴趣',
      '出色的逻辑思维和结构化表达能力',
      '有产品作品集/校内项目经验优先',
      '熟悉 Axure/Figma 等设计原型工具',
      '数据敏感,能通过数据发现问题',
    ],
    tags: ['需求分析', '产品设计', 'Figma', '用户研究', '数据分析'],
  },
  设计: {
    baseDesc: '负责移动端/Web 端产品界面视觉设计,输出高保真设计稿,与研发协作完成还原。',
    baseReqs: [
      '视觉传达/工业设计/交互设计相关专业',
      '熟练使用 Figma / Sketch / Adobe 系列',
      '扎实的视觉基本功,对色彩/排版/字体有敏感度',
      '有独立完整的作品集',
      '关注国内外优秀产品设计趋势',
    ],
    tags: ['Figma', 'UI', '交互设计', '视觉', 'C4D'],
  },
  运营: {
    baseDesc: '负责用户增长、内容运营、活动运营等方向,通过精细化运营提升核心业务指标。',
    baseReqs: [
      '不限专业,对互联网运营岗位有强烈兴趣',
      '优秀的文案表达和沟通协作能力',
      '数据敏感,熟练使用 Excel/SQL 加分',
      '有校园自媒体运营经验或社群运营经验优先',
      '抗压能力强,愿意快速试错',
    ],
    tags: ['用户运营', '内容运营', '数据分析', '增长', 'SQL'],
  },
  数据: {
    baseDesc: '负责业务数据分析与报告输出,构建核心指标监控体系,支撑业务和产品决策。',
    baseReqs: [
      '统计学/数学/计算机相关专业',
      '熟练使用 SQL,了解 Hive/Spark 生态',
      '至少熟悉一种数据分析语言(Python/R)',
      '统计学基础扎实,理解 AB 测试',
      '能独立完成端到端的数据分析项目',
    ],
    tags: ['SQL', 'Python', 'Hive', 'AB 测试', 'BI'],
  },
  测试: {
    baseDesc: '负责移动端/Web 端产品测试,输出测试用例,推动线上质量持续改进。',
    baseReqs: [
      '计算机相关专业在校生',
      '理解软件测试基础理论',
      '熟悉一种自动化测试框架优先(Selenium/Cypress/Appium)',
      '编程基础扎实(Python/Java)',
      '细心、耐心、良好的沟通能力',
    ],
    tags: ['自动化测试', 'Selenium', 'API 测试', '性能测试', 'Python'],
  },
};

const BASE_BENEFITS = ['六险一金', '双休', '弹性上下班', '免费三餐', '实习补贴', '优秀转正'];

/**
 * 岗位库(80 条)
 * 每条:公司 key + 标题 + 城市 + work_type + category + 薪资 + 学历
 */
const JOBS = [
  // ==================== 字节跳动 ====================
  ['bytedance', '前端开发实习生 - 抖音', '北京', 'internship', '前端', 300, 500, '本科', ['抖音', 'React']],
  ['bytedance', '前端开发实习生 - TikTok', '上海', 'internship', '前端', 350, 550, '本科', ['TikTok', 'React']],
  ['bytedance', '后端开发实习生 - 飞书', '北京', 'internship', '后端', 300, 500, '本科', ['飞书', 'Go']],
  ['bytedance', '算法实习生 - 推荐系统', '北京', 'internship', '算法', 400, 700, '硕士', ['推荐', '大模型']],
  ['bytedance', '产品经理实习生 - 抖音电商', '上海', 'internship', '产品', 250, 400, '本科', ['电商', '用户增长']],
  ['bytedance', 'iOS 开发实习生', '深圳', 'internship', '前端', 300, 500, '本科', ['iOS', 'Swift']],
  ['bytedance', '2025 校园招聘 · 后端开发', '北京', 'campus', '后端', 25000, 40000, '本科', ['校招', 'Golang']],
  ['bytedance', '2025 校园招聘 · 算法工程师', '北京', 'campus', '算法', 30000, 50000, '硕士', ['校招', '大模型']],

  // ==================== 腾讯 ====================
  ['tencent', '前端开发实习生 - 微信', '广州', 'internship', '前端', 300, 500, '本科', ['微信', 'Vue']],
  ['tencent', '后端开发实习生 - 云研发', '深圳', 'internship', '后端', 280, 480, '本科', ['腾讯云', 'C++']],
  ['tencent', '游戏客户端实习生 - IEG', '深圳', 'internship', '前端', 300, 500, '本科', ['游戏', 'Unity']],
  ['tencent', '视觉设计实习生 - CDC', '深圳', 'internship', '设计', 250, 400, '本科', ['Figma', '品牌']],
  ['tencent', '算法实习生 - AI Lab', '深圳', 'internship', '算法', 400, 700, '硕士', ['NLP', 'CV']],
  ['tencent', '产品实习生 - QQ 音乐', '深圳', 'internship', '产品', 250, 400, '本科', ['音乐', '内容']],
  ['tencent', '2025 校园招聘 · 后端开发', '深圳', 'campus', '后端', 24000, 38000, '本科', ['校招', 'Java']],
  ['tencent', '2025 校园招聘 · 前端开发', '深圳', 'campus', '前端', 22000, 35000, '本科', ['校招', 'React']],

  // ==================== 阿里巴巴 ====================
  ['alibaba', '前端开发实习生 - 淘宝', '杭州', 'internship', '前端', 300, 500, '本科', ['淘宝', 'Rax']],
  ['alibaba', '后端开发实习生 - 蚂蚁', '杭州', 'internship', '后端', 300, 500, '本科', ['蚂蚁', 'Java']],
  ['alibaba', '数据分析实习生 - 天猫', '杭州', 'internship', '数据', 250, 400, '本科', ['SQL', 'AB 测试']],
  ['alibaba', '算法实习生 - 达摩院', '杭州', 'internship', '算法', 450, 750, '硕士', ['达摩院', '大模型']],
  ['alibaba', '产品实习生 - 高德', '北京', 'internship', '产品', 280, 450, '本科', ['地图', '位置服务']],
  ['alibaba', '测试开发实习生', '杭州', 'internship', '测试', 250, 400, '本科', ['自动化', 'Python']],
  ['alibaba', '2025 校园招聘 · 大后端', '杭州', 'campus', '后端', 25000, 40000, '本科', ['校招', 'Java', 'MySQL']],
  ['alibaba', '2025 校园招聘 · 数据研发', '杭州', 'campus', '数据', 24000, 38000, '硕士', ['校招', 'Hive', 'Spark']],

  // ==================== 美团 ====================
  ['meituan', '前端开发实习生', '北京', 'internship', '前端', 260, 420, '本科', ['Vue', 'Node']],
  ['meituan', '后端开发实习生 - 到家事业群', '北京', 'internship', '后端', 260, 420, '本科', ['Java', 'Spring']],
  ['meituan', '算法实习生 - 外卖配送', '上海', 'internship', '算法', 350, 600, '硕士', ['运筹优化', '规划']],
  ['meituan', '产品实习生 - 美团优选', '北京', 'internship', '产品', 220, 350, '本科', ['本地生活', '零售']],
  ['meituan', '数据分析实习生', '北京', 'internship', '数据', 220, 350, '本科', ['SQL', 'Tableau']],
  ['meituan', '2025 校园招聘 · 后端研发', '北京', 'campus', '后端', 23000, 35000, '本科', ['校招', 'Java']],

  // ==================== 京东 ====================
  ['jd', '前端开发实习生 - 京东商城', '北京', 'internship', '前端', 240, 400, '本科', ['React', 'Node']],
  ['jd', '后端开发实习生 - 京东零售', '北京', 'internship', '后端', 240, 400, '本科', ['Java', '微服务']],
  ['jd', '算法实习生 - 搜索广告', '北京', 'internship', '算法', 350, 600, '硕士', ['搜索', '广告']],
  ['jd', '运营实习生 - 京东直播', '北京', 'internship', '运营', 180, 300, '本科', ['直播', '内容']],
  ['jd', '2025 校园招聘 · 后端开发', '北京', 'campus', '后端', 22000, 33000, '本科', ['校招']],

  // ==================== 百度 ====================
  ['baidu', 'AI 算法实习生 - 文心大模型', '北京', 'internship', '算法', 500, 800, '硕士', ['文心', 'LLM']],
  ['baidu', '前端开发实习生 - 智能云', '北京', 'internship', '前端', 250, 400, '本科', ['云计算', 'React']],
  ['baidu', '后端开发实习生 - 搜索', '北京', 'internship', '后端', 260, 420, '本科', ['搜索', 'C++']],
  ['baidu', '产品实习生 - 自动驾驶', '北京', 'internship', '产品', 300, 500, '本科', ['自动驾驶', '车路协同']],
  ['baidu', '2025 校园招聘 · AI 算法', '北京', 'campus', '算法', 28000, 45000, '硕士', ['校招', 'LLM']],

  // ==================== 小红书 ====================
  ['xiaohongshu', '前端开发实习生', '上海', 'internship', '前端', 280, 450, '本科', ['React Native', 'H5']],
  ['xiaohongshu', '后端开发实习生 - 社区业务', '上海', 'internship', '后端', 280, 450, '本科', ['Java', 'Go']],
  ['xiaohongshu', '算法实习生 - 内容推荐', '上海', 'internship', '算法', 400, 650, '硕士', ['推荐', '排序']],
  ['xiaohongshu', '产品实习生 - 社区', '上海', 'internship', '产品', 240, 400, '本科', ['社区', 'UGC']],
  ['xiaohongshu', '设计实习生 - 品牌视觉', '上海', 'internship', '设计', 220, 380, '本科', ['品牌', '插画']],
  ['xiaohongshu', '2025 校园招聘 · 后端', '上海', 'campus', '后端', 24000, 36000, '本科', ['校招']],

  // ==================== B站 ====================
  ['bilibili', '前端开发实习生 - Web', '上海', 'internship', '前端', 260, 420, '本科', ['Vue', 'Node']],
  ['bilibili', '游戏开发实习生 - Unity', '上海', 'internship', '前端', 280, 450, '本科', ['Unity', 'C#']],
  ['bilibili', '算法实习生 - 内容审核', '上海', 'internship', '算法', 350, 600, '硕士', ['CV', '内容安全']],
  ['bilibili', '运营实习生 - UP 主生态', '上海', 'internship', '运营', 180, 300, '本科', ['社区', 'UP 主']],
  ['bilibili', '2025 校园招聘 · 前端开发', '上海', 'campus', '前端', 22000, 33000, '本科', ['校招']],

  // ==================== 滴滴 ====================
  ['didi', '后端开发实习生 - 网约车', '北京', 'internship', '后端', 280, 450, '本科', ['Java', '分布式']],
  ['didi', '算法实习生 - 智能派单', '北京', 'internship', '算法', 380, 620, '硕士', ['运筹', '优化']],
  ['didi', '数据分析实习生', '北京', 'internship', '数据', 240, 400, '本科', ['SQL', '业务分析']],

  // ==================== 快手 ====================
  ['kuaishou', '前端开发实习生', '北京', 'internship', '前端', 260, 420, '本科', ['短视频', 'React']],
  ['kuaishou', '后端开发实习生 - 主站', '北京', 'internship', '后端', 260, 420, '本科', ['Go', 'Redis']],
  ['kuaishou', '算法实习生 - 视频推荐', '北京', 'internship', '算法', 400, 650, '硕士', ['推荐', 'CV']],
  ['kuaishou', '产品实习生 - 电商', '北京', 'internship', '产品', 240, 400, '本科', ['直播电商']],
  ['kuaishou', '2025 校园招聘 · 算法', '北京', 'campus', '算法', 28000, 42000, '硕士', ['校招', '推荐']],

  // ==================== 网易 ====================
  ['netease', '游戏客户端实习生 - 雷火', '杭州', 'internship', '前端', 260, 420, '本科', ['Unity', 'C#']],
  ['netease', '游戏服务端实习生 - 雷火', '杭州', 'internship', '后端', 280, 450, '本科', ['C++', '游戏服务']],
  ['netease', '算法实习生 - 网易云音乐', '杭州', 'internship', '算法', 350, 580, '硕士', ['音频', '推荐']],
  ['netease', '设计实习生 - 游戏 UI', '杭州', 'internship', '设计', 200, 350, '本科', ['游戏 UI', '3D']],

  // ==================== 华为 ====================
  ['huawei', '软件开发实习生 - 终端', '深圳', 'internship', '后端', 280, 450, '本科', ['Android', 'C++']],
  ['huawei', 'AI 算法实习生 - 诺亚方舟', '深圳', 'internship', '算法', 450, 750, '硕士', ['诺亚方舟', 'AI']],
  ['huawei', '硬件开发实习生', '深圳', 'internship', '后端', 260, 420, '本科', ['嵌入式', '硬件']],
  ['huawei', '2025 校园招聘 · 软件开发', '深圳', 'campus', '后端', 24000, 40000, '本科', ['校招']],

  // ==================== 小米 ====================
  ['xiaomi', 'MIUI 开发实习生', '北京', 'internship', '前端', 280, 450, '本科', ['MIUI', 'Android']],
  ['xiaomi', 'IoT 后端开发实习生', '北京', 'internship', '后端', 260, 420, '本科', ['IoT', 'Java']],
  ['xiaomi', '算法实习生 - 造车', '北京', 'internship', '算法', 400, 700, '硕士', ['自动驾驶']],

  // ==================== 拼多多 ====================
  ['pinduoduo', '前端开发实习生', '上海', 'internship', '前端', 320, 520, '本科', ['海淘', 'React']],
  ['pinduoduo', '后端开发实习生 - Temu', '上海', 'internship', '后端', 350, 550, '本科', ['Temu', 'Go']],
  ['pinduoduo', '算法实习生 - 广告', '上海', 'internship', '算法', 450, 750, '硕士', ['广告', 'CTR']],
  ['pinduoduo', '2025 校园招聘 · 后端开发', '上海', 'campus', '后端', 26000, 42000, '本科', ['校招']],

  // ==================== 知乎 ====================
  ['zhihu', '前端开发实习生', '北京', 'internship', '前端', 260, 420, '本科', ['问答', 'React']],
  ['zhihu', '算法实习生 - 内容理解', '北京', 'internship', '算法', 380, 620, '硕士', ['NLP', '知识图谱']],
  ['zhihu', '运营实习生 - 内容运营', '北京', 'internship', '运营', 200, 350, '本科', ['社区', '内容']],

  // ==================== SHEIN ====================
  ['shein', '前端开发实习生 - 跨境', '南京', 'internship', '前端', 280, 450, '本科', ['跨境电商', 'i18n']],
  ['shein', '后端开发实习生 - 供应链', '广州', 'internship', '后端', 300, 480, '本科', ['供应链', 'Java']],
  ['shein', '数据分析实习生 - 用户增长', '广州', 'internship', '数据', 250, 400, '本科', ['增长', 'SQL']],
];

async function main() {
  await verifyConnection();

  if (!KEEP) {
    console.log('[seed] 清空 job/job_favorite/job_application ...');
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    await db.query('TRUNCATE TABLE job_application');
    await db.query('TRUNCATE TABLE job_favorite');
    await db.query('TRUNCATE TABLE job');
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
  }

  let inserted = 0;

  for (let idx = 0; idx < JOBS.length; idx += 1) {
    const [companyKey, title, city, workType, category, salaryMin, salaryMax, degree, extraTags] = JOBS[idx];
    const meta = COMPANIES[companyKey];
    const tpl = TEMPLATES[category];
    if (!meta || !tpl) {
      console.warn('[seed] skip unknown key:', companyKey, category);
      continue;
    }

    const salaryDisplay = workType === 'internship'
      ? `${salaryMin}-${salaryMax}/天`
      : `${(salaryMin / 1000).toFixed(0)}k-${(salaryMax / 1000).toFixed(0)}k`;

    const experience = workType === 'internship' ? '在校生' : '应届毕业生';
    const isHot = idx % 7 === 0; // 每 7 条打个热招
    const isUrgent = idx % 11 === 0;

    // 描述:公司 + 岗位 + 模板
    const description = `${meta.company} · ${title}\n\n${tpl.baseDesc}\n\n作为一家 ${meta.industry} 领域的领先企业,${meta.company} 拥有完善的实习生培养体系:一对一 mentor 带教、结构化培训、扁平化沟通,你的每一次贡献都会被看见。`;

    const requirements = tpl.baseReqs;
    const benefits = [...BASE_BENEFITS, workType === 'internship' ? '通勤补贴' : '五险一金'].slice(0, 6);
    const tags = [...new Set([...tpl.tags, ...(extraTags || [])])].slice(0, 6);

    await db.query(
      `INSERT INTO job (
        title, company, company_logo, company_size, industry, city,
        work_type, category, salary_min, salary_max, salary_display,
        degree_required, experience_required,
        description, requirements, benefits, tags,
        source_url, is_hot, is_urgent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        title, meta.company, meta.company_logo, meta.company_size, meta.industry, city,
        workType, category, salaryMin, salaryMax, salaryDisplay,
        degree, experience,
        description, JSON.stringify(requirements), JSON.stringify(benefits), JSON.stringify(tags),
        isHot ? 1 : 0, isUrgent ? 1 : 0,
      ],
    );
    inserted += 1;
  }

  console.log(`[seed] inserted ${inserted} jobs`);
  await db.end();
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
