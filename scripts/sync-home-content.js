/**
 * 同步公开内容到首页文章库。
 *
 * 默认来源:
 *   - zhihu/juejin: 通过 NewsNow 的缓存接口读取公开热榜,只保存标题、短摘要和原文链接
 *   - hackernews: 通过 Hacker News 官方 Firebase API 读取开发者社区条目
 *
 * 用法:
 *   npm run content:sync
 *   npm run content:sync -- --source=zhihu --limit=20
 *   npm run content:sync -- --source=zhihu --dry-run
 *
 * 该脚本只在后端运行,不把第三方接口暴露给浏览器。外部条目通过
 * (source_type, external_id) 幂等写入,重复执行不会产生重复文章。
 */

require('dotenv').config();

const crypto = require('node:crypto');
const { db, verifyConnection } = require('../src/db');
const articleRepository = require('../src/repositories/articleRepository');

const args = process.argv.slice(2);
const getArg = (name) => {
  const prefix = `--${name}=`;
  const value = args.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
};

const SOURCE_NAMES = {
  zhihu: '知乎热榜',
  juejin: '掘金社区',
};

const DEFAULT_RELEVANT_TERMS = [
  '大学',
  '学生',
  '校园',
  '高校',
  '考研',
  '考公',
  '研究生',
  '博士',
  '实习',
  '就业',
  '校招',
  '招聘',
  '求职',
  '简历',
  '面试',
  '编程',
  '前端',
  '后端',
  '程序员',
  '人工智能',
  '大模型',
  '深度学习',
  '开源',
  '算法',
  '创业',
  '竞赛',
  '四六级',
  '证书',
  '考试',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cleanText(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\\u[0-9a-f]{4}/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(value, length) {
  const text = cleanText(value);
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_err) {
    return false;
  }
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 40);
}

function toMysqlDate(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function fetchJson(url, { timeoutMs = 10_000, retries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const requestUrl = new URL(url);
      const headers = {
        Accept: 'application/json',
        'User-Agent': process.env.CONTENT_SYNC_USER_AGENT || 'SmartCampusContentSync/1.0',
      };
      // NewsNow 的公开缓存接口需要标准浏览器 Referer,不涉及登录态或私有接口。
      if (requestUrl.hostname === 'newsnow.busiyi.world') {
        headers.Referer = `${requestUrl.origin}/`;
        headers['User-Agent'] =
          process.env.CONTENT_SYNC_USER_AGENT ||
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 SmartCampusContentSync/1.0';
      }
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(250 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function categorySlugFor(text) {
  const value = cleanText(text);
  if (/考研|考公|研究生|博士|复试|保研/.test(value)) return 'grad';
  if (/四六级|英语|考试|证书|考证|认证/.test(value)) return 'cert';
  if (/竞赛|比赛|大赛|挑战赛|奖学金/.test(value)) return 'match';
  if (/校招|实习|就业|招聘|简历|面试|职业|职场|秋招|春招/.test(value)) return 'campus';
  return 'innov';
}

function isRelevant(title, excerpt) {
  // 热榜摘要经常顺带提到“学习/职业”等泛词,优先看标题并只取短摘要。
  const text = `${title} ${String(excerpt || '').slice(0, 180)}`.toLowerCase();
  return DEFAULT_RELEVANT_TERMS.some((term) => text.includes(term.toLowerCase()));
}

function buildContent({ excerpt, sourceName, sourceUrl, originalUrl = null }) {
  const paragraphs = [];
  if (excerpt) paragraphs.push(`<p>${escapeHtml(excerpt)}</p>`);
  if (originalUrl && originalUrl !== sourceUrl && isHttpUrl(originalUrl)) {
    paragraphs.push(
      `<p>原文链接：<a href="${escapeHtml(originalUrl)}" target="_blank" rel="noreferrer">打开原文</a></p>`,
    );
  }
  if (sourceUrl) {
    paragraphs.push(
      `<p>内容来源：<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(sourceName || '公开来源')}</a></p>`,
    );
  }
  return paragraphs.join('') || '<p>该条目暂无摘要,请打开来源查看详情。</p>';
}

function normalizeNewsNow(data, sourceId, { allowAll = false, limit = 20 } = {}) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const sourceName = SOURCE_NAMES[sourceId] || `公开来源 ${sourceId}`;

  return items
    .map((item) => {
      const title = truncate(item?.title, 200);
      const sourceUrl = isHttpUrl(item?.url) ? item.url : null;
      const excerpt = truncate(item?.extra?.hover || item?.description || '', 460);
      const displayExcerpt = excerpt || `来自${sourceName}的公开热榜条目。`;
      if (!title || !sourceUrl) return null;
      if (!allowAll && sourceId === 'zhihu' && !isRelevant(title, excerpt)) return null;

      const externalId = `${sourceId}:${item.id || hash(sourceUrl)}`;
      return {
        sourceId,
        title,
        excerpt: displayExcerpt,
        content: buildContent({ excerpt: displayExcerpt, sourceName, sourceUrl }),
        categorySlug: categorySlugFor(`${title} ${excerpt}`),
        authorName: sourceName,
        sourceType: 'newsnow',
        sourceName,
        sourceUrl,
        externalId,
        publishedAt: toMysqlDate(item.pubDate || item.timestamp || data.updatedTime),
        sortType: 'recommend',
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}

async function fetchNewsNow(sourceId, options) {
  const baseUrl = process.env.CONTENT_NEWSNOW_BASE_URL || 'https://newsnow.busiyi.world';
  const url = `${baseUrl.replace(/\/$/, '')}/api/s?id=${encodeURIComponent(sourceId)}`;
  const data = await fetchJson(url);
  return normalizeNewsNow(data, sourceId, options);
}

async function fetchHackerNews({ limit = 20 } = {}) {
  const ids = await fetchJson('https://hacker-news.firebaseio.com/v0/topstories.json');
  const selected = Array.isArray(ids) ? ids.slice(0, Math.max(limit * 2, limit)) : [];
  const items = [];

  for (let i = 0; i < selected.length; i += 5) {
    const batch = selected.slice(i, i + 5);
    const rows = await Promise.all(
      batch.map(async (id) => {
        try {
          return await fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        } catch (error) {
          console.warn('[content-sync] skip Hacker News item %s: %s', id, error.message);
          return null;
        }
      }),
    );
    items.push(...rows.filter((item) => item?.type === 'story' && item.title));
    if (items.length >= limit) break;
  }

  return items.slice(0, limit).map((item) => {
    const sourceUrl = `https://news.ycombinator.com/item?id=${item.id}`;
    const originalUrl = isHttpUrl(item.url) ? item.url : null;
    const excerpt = truncate(
      cleanText(item.text) || '开发者社区热门讨论,打开来源查看完整内容。',
      460,
    );
    return {
      sourceId: 'hackernews',
      title: truncate(item.title, 200),
      excerpt,
      content: buildContent({
        excerpt,
        sourceName: 'Hacker News',
        sourceUrl,
        originalUrl,
      }),
      categorySlug: categorySlugFor(`${item.title} ${excerpt}`),
      authorName: 'Hacker News',
      sourceType: 'hackernews',
      sourceName: 'Hacker News',
      sourceUrl,
      externalId: String(item.id),
      publishedAt: toMysqlDate((item.time || 0) * 1000),
      sortType: 'recommend',
    };
  });
}

async function loadCategoryIds() {
  const [rows] = await db.query('SELECT id, slug FROM category');
  return new Map(rows.map((row) => [row.slug, row.id]));
}

async function main() {
  const sourceArg =
    getArg('source') || process.env.CONTENT_SYNC_SOURCES || 'zhihu,juejin,hackernews';
  const sources = sourceArg
    .split(',')
    .map((source) => source.trim().toLowerCase())
    .filter(Boolean);
  const limit = Math.min(
    Math.max(Number(getArg('limit') || process.env.CONTENT_SYNC_LIMIT || 20), 1),
    50,
  );
  const dryRun = args.includes('--dry-run');
  const allowAll = args.includes('--allow-all');
  const prune = args.includes('--prune');

  await verifyConnection();
  const categoryIds = await loadCategoryIds();
  const records = [];
  const recordsBySource = new Map();
  const failures = [];

  for (const source of sources) {
    try {
      const rows =
        source === 'hackernews'
          ? await fetchHackerNews({ limit })
          : await fetchNewsNow(source, { allowAll, limit });
      console.log('[content-sync] %s fetched %d items', source, rows.length);
      recordsBySource.set(source, rows);
      records.push(...rows);
    } catch (error) {
      failures.push(`${source}: ${error.message}`);
      console.warn('[content-sync] %s failed: %s', source, error.message);
    }
  }

  let inserted = 0;
  let updated = 0;
  for (const record of records) {
    const categoryId = categoryIds.get(record.categorySlug) || categoryIds.get('innov') || null;
    if (!categoryId) {
      console.warn('[content-sync] skip %s: no category table', record.title);
      continue;
    }

    if (dryRun) {
      console.log(
        '[content-sync] dry-run [%s] %s -> %s',
        record.sourceName,
        record.title,
        record.categorySlug,
      );
      continue;
    }

    const result = await articleRepository.upsertExternal({
      ...record,
      categoryId,
    });
    if (result.inserted) inserted += 1;
    else updated += 1;
  }

  if (prune && !dryRun) {
    let deleted = 0;
    for (const [source, rows] of recordsBySource) {
      // 只有成功拿到非空结果才允许清理,避免上游短暂故障导致误删。
      if (!rows.length) continue;
      const externalIds = rows.map((row) => row.externalId);
      const sourceType = source === 'hackernews' ? 'hackernews' : 'newsnow';
      const prefix = source === 'hackernews' ? null : `${source}:`;
      const clauses = ['source_type = ?'];
      const params = [sourceType];
      if (prefix) {
        clauses.push('external_id LIKE ?');
        params.push(`${prefix}%`);
      }
      clauses.push(`external_id NOT IN (${externalIds.map(() => '?').join(',')})`);
      params.push(...externalIds);
      const [result] = await db.query(`DELETE FROM article WHERE ${clauses.join(' AND ')}`, params);
      deleted += result.affectedRows;
    }
    console.log('[content-sync] pruned=%d stale external items', deleted);
  }

  console.log(
    '[content-sync] complete: fetched=%d inserted=%d updated=%d dryRun=%s prune=%s',
    records.length,
    inserted,
    updated,
    dryRun,
    prune,
  );
  if (failures.length) console.warn('[content-sync] failures: %s', failures.join('; '));
  if (!records.length && failures.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('[content-sync] fatal:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
