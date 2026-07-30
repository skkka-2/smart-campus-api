/**
 * Mock Agent —— 当 OPENAI 不可用/被限流时的兜底
 *
 * 通过设置环境变量 AGENT_MOCK=true 强制启用;
 * 或 agentService 检测到 OpenAI 报错时自动切到这里(demo 场景友好)。
 *
 * 它模拟 LLM 的决策过程:根据用户消息的关键词决定要调什么工具,
 * 执行完拼一段"像 AI 写的"回复。这样前端看到的事件流和真 LLM 完全一致,
 * demo 效果不打折。
 */

const { getTool, unwrapToolData } = require('../agent/toolRegistry');
const agentTracer = require('../observability/agentTracer');

function classifyIntent(text, context = {}) {
  const s = String(text || '').toLowerCase();
  if (context.jobId && /适合|匹配|岗位|投递|留言|收藏|对比|为什么/.test(s)) return 'context_job';
  if (/推荐|最匹配|适合我|适合的|给我几个|来几个/.test(s)) return 'recommend';
  if (/收藏|收藏夹|标记/.test(s)) return 'favorites';
  if (/投递|投过|申请了|投了/.test(s)) return 'applications';
  if (/找|搜|查|列出|多少|列表/.test(s) && /岗|工作|实习|职位/.test(s)) return 'search';
  if (/我是谁|画像|资料|简介/.test(s)) return 'profile';
  if (/你好|hi|hello|嗨/.test(s)) return 'greeting';
  return 'general';
}

/** 从消息里提取可能的岗位方向 */
function guessCategory(text) {
  const map = {
    '前端': '前端', 'frontend': '前端',
    '后端': '后端', 'backend': '后端', '服务端': '后端',
    '算法': '算法', 'ai': '算法', '机器学习': '算法',
    '产品': '产品', 'pm': '产品',
    '设计': '设计', 'ui': '设计',
    '运营': '运营',
    '数据': '数据',
    '测试': '测试', 'qa': '测试',
  };
  const s = String(text || '').toLowerCase();
  for (const [k, v] of Object.entries(map)) {
    if (s.includes(k)) return v;
  }
  return null;
}

function guessCity(text) {
  const cities = ['北京', '上海', '深圳', '杭州', '广州', '南京', '成都', '武汉'];
  return cities.find((c) => text.includes(c)) || null;
}

/**
 * 主入口 —— 签名与真 agent 一致
 * @param {number} userId
 * @param {string} userMessage
 * @param {(event) => void} onEvent
 */
async function runMockAgent(userId, userMessage, onEvent, context = {}) {
  const intent = classifyIntent(userMessage, context);
  const executedCalls = [];

  async function callTool(name, args = {}) {
    onEvent({ type: 'tool_call', id: `mock-${Date.now()}`, name, arguments: args });
    const tool = getTool(name);
    if (!tool) {
      const err = `未知工具 ${name}`;
      onEvent({ type: 'tool_result', name, error: err });
      return { error: err };
    }
    try {
      const result = await agentTracer.withSpan(`agent.tool.${name}`, {
        'agent.tool.name': name,
        'agent.tool.args': agentTracer.summarizeToolArgs(args),
        'agent.mock': true,
      }, async (span) => {
        const toolResult = await tool.handler(args, { userId });
        span.setAttributes({
          'agent.tool.ok': toolResult?.ok !== false,
          'agent.tool.summary': toolResult?.display?.summary || '',
        });
        return toolResult;
      });
      const data = unwrapToolData(result);
      onEvent({
        type: 'tool_result',
        name,
        ok: true,
        summary: result?.display?.summary,
        result,
      });
      executedCalls.push({ name, args, result: data, rawResult: result });
      return { result: data };
    } catch (err) {
      const msg = err.message || String(err);
      onEvent({ type: 'tool_result', name, ok: false, summary: msg, error: msg });
      executedCalls.push({ name, args, error: msg });
      return { error: msg };
    }
  }

  onEvent({ type: 'thinking', step: 0 });

  // 短暂延时,模拟 LLM 思考
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(400);

  let finalText;

  if (intent === 'greeting') {
    await callTool('get_my_profile');
    const profile = executedCalls[0]?.result || {};
    finalText = `你好${profile.username ? ` ${profile.username}` : ''}!我是你的智学助手,可以帮你:\n\n` +
      `• 基于你的画像推荐最匹配的实习岗位\n` +
      `• 搜索特定方向/城市的岗位\n` +
      `• 分析简历适配度\n` +
      `• 帮你收藏或投递岗位\n\n` +
      `试试问我"帮我推荐 5 个最匹配的前端岗位"?`;
  } else if (intent === 'profile') {
    await callTool('get_my_profile');
    const p = executedCalls[0]?.result || {};
    finalText = [
      `根据档案,你目前是**${p.college || '未填'}${p.major ? ' · ' + p.major : ''}${p.grade ? ' · ' + p.grade : ''}**。`,
      p.career_direction ? `意向方向:**${p.career_direction}**` : '',
      p.preferred_city ? `意向城市:**${p.preferred_city}**` : '',
      p.interests?.length ? `已标注的兴趣技能:${p.interests.join(' / ')}` : '',
      '',
      '如果你想让匹配度更准,记得去「我的主页」补齐画像 👀',
    ].filter(Boolean).join('\n');
  } else if (intent === 'context_job') {
    const jobId = Number(context.jobId);
    await callTool('get_job_detail', { id: jobId });
    await callTool('get_my_profile');
    const job = executedCalls[0]?.result || {};
    const profile = executedCalls[1]?.result || {};
    const interests = profile.interests?.length ? profile.interests.join(' / ') : '暂未填写';
    finalText = [
      `我先看了这个岗位和你的画像。目标岗位是 **${job.company || '未知公司'} · ${job.title || `岗位 ${jobId}`}**。`,
      '',
      `你的方向/技能线索: ${profile.career_direction || '未填写方向'}; 兴趣技能: ${interests}。`,
      '',
      '可以这样准备:',
      `1. 投递留言先对齐岗位关键词: ${(job.tags || []).slice(0, 4).join(' / ') || '项目经历、学习能力、岗位兴趣'}。`,
      `2. 简历项目描述要写清楚"做了什么、用了什么技术、结果如何"。`,
      '3. 如果要投递,我会先让你确认,不会直接替你提交。',
    ].join('\n');
  } else if (intent === 'recommend') {
    await callTool('recommend_jobs', { limit: 5 });
    const items = executedCalls[0]?.result || [];
    if (!items.length) {
      finalText = '暂时没找到匹配的岗位,建议先去「我的主页」补齐画像。';
    } else {
      const top = items.slice(0, 5);
      const lines = top.map((j, i) => {
        const m = j.match_score != null ? ` · 匹配度 ${j.match_score}%` : '';
        return `${i + 1}. **${j.company} · ${j.title}**(${j.city} · ${j.salary_display}${m})`;
      });
      finalText = `根据你的画像,这几个岗位最值得关注:\n\n${lines.join('\n')}\n\n` +
        `第 1 名是最匹配的 —— 想看详细要求,可以问我"帮我看 ${top[0].company} 那个岗位的详情"。`;
    }
  } else if (intent === 'search') {
    const category = guessCategory(userMessage);
    const city = guessCity(userMessage);
    await callTool('list_jobs', {
      category: category || undefined,
      city: city || undefined,
      limit: 8,
    });
    const items = executedCalls[0]?.result || [];
    if (!items.length) {
      finalText = '没有找到符合条件的岗位。可以试试放宽筛选(比如去掉城市限制)。';
    } else {
      const preview = items.slice(0, 5).map((j) =>
        `- **${j.company} · ${j.title}** · ${j.city} · ${j.salary_display}`).join('\n');
      finalText = `找到 ${items.length} 个${category ? ` ${category}` : ''}${city ? ` ${city}` : ''}岗位,前 5 个:\n\n${preview}\n\n` +
        `想深入了解某一个,告诉我序号或者公司名。`;
    }
  } else if (intent === 'favorites') {
    await callTool('list_my_favorites');
    const items = executedCalls[0]?.result || [];
    if (!items.length) {
      finalText = '你还没有收藏过任何岗位。要不要我先推荐 5 个匹配度高的?';
    } else {
      const lines = items.slice(0, 8).map((j, i) =>
        `${i + 1}. **${j.company} · ${j.title}**(${j.city} · ${j.salary_display})`);
      finalText = `你目前收藏了 ${items.length} 个岗位:\n\n${lines.join('\n')}\n\n有想深入看的直接跟我说公司名就行。`;
    }
  } else if (intent === 'applications') {
    await callTool('list_my_applications');
    const items = executedCalls[0]?.result || [];
    if (!items.length) {
      finalText = '你还没有投递记录。要我帮你看看有哪些高匹配度岗位吗?';
    } else {
      const STATUS_ZH = {
        pending: '等待反馈', viewed: 'HR 已查看',
        interview: '面试邀约', offer: 'Offer 到手',
        rejected: '未通过', withdrawn: '已撤回',
      };
      const lines = items.slice(0, 10).map((a) =>
        `- **${a.company} · ${a.title}** —— ${STATUS_ZH[a.status] || a.status}`);
      finalText = `你已经投递了 ${items.length} 个岗位:\n\n${lines.join('\n')}\n\n` +
        `保持每天关注状态更新,pending 一般 3-7 天会有反馈。`;
    }
  } else {
    // general fallback:先读画像,再给基于画像的通用建议
    await callTool('get_my_profile');
    const p = executedCalls[0]?.result || {};
    finalText = `嗯,让我想想...(mock 模式下我暂时只擅长回答关于"岗位推荐"、"搜索岗位"、"简历适配"这类问题)\n\n` +
      `根据你的画像(${p.major || '未填专业'}${p.grade ? ' / ' + p.grade : ''}),你可以问我:\n` +
      `• "帮我找几个最匹配的岗位"\n` +
      `• "北京的算法实习有哪些"\n` +
      `• "看看我投过什么"`;
  }

  agentTracer.updateCurrentObservation({
    output: agentTracer.previewText(finalText, 800),
    metadata: {
      toolCalls: executedCalls.length,
      outputLength: finalText.length,
      mock: true,
    },
  }, 'agent');
  onEvent({
    type: 'final',
    content: finalText,
    toolCalls: executedCalls.length,
    traceContext: agentTracer.getTraceContext(),
  });
  return { finalText, toolCalls: executedCalls };
}

module.exports = { runMockAgent };
