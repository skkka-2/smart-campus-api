# 首页内容同步

首页文章不再依赖前端直接请求知乎、掘金等站点。后端脚本把公开内容转成 SmartCampus 的文章记录,页面仍然只读取自己的 `/api/articles`。

## 当前适配器

- `zhihu`: 读取 NewsNow 缓存的知乎公开热榜,默认只保留大学、就业、技术、学习等相关条目。
- `hackernews`: 读取 Hacker News 官方 Firebase API 的热门开发者条目。
- `juejin`: 通过同一套 NewsNow source id 读取公开热榜,保存技术文章标题、短摘要和掘金原文链接。

知乎官方开放平台需要 Bearer access secret;掘金站内接口没有确认到稳定的公开内容 API,所以不把站点内部接口写进生产代码。NewsNow 只保存标题、短摘要和原文链接,并通过 `source_type + external_id` 去重。

## 本地执行

首次升级已有数据库:

```bash
npm run db:migrate
```

同步默认来源:

```bash
npm run content:sync
```

只同步知乎,最多 30 条:

```bash
npm run content:sync -- --source=zhihu --limit=30
```

只预览,不写数据库:

```bash
npm run content:sync -- --source=zhihu --dry-run
```

知乎内容默认做校园/学习/技术相关性过滤。确认需要全部热榜时才使用:

```bash
npm run content:sync -- --source=zhihu --allow-all
```

## 上线建议

用 cron、systemd timer 或部署平台的定时任务每 30~60 分钟执行一次。脚本失败会保留已有文章,重复执行会更新同一个外部条目而不是插入重复记录。生产环境应保留来源链接、设置合理超时与频率,并根据目标站点的公开 API、RSS 和服务条款接入,不要抓取登录态或绕过风控。
