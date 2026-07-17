-- ============================================================
-- smart-campus-api  schema v2
-- ============================================================
--   - 合并 recommendlist / likelist → article,加 sort_type 区分
--   - 新增 category / article_like 关系表
--   - comment 加 article_id 外键
--
-- 使用方法(全新初始化):
--   mysql -u root -p < schema.sql
--
-- 兼容说明:此脚本会 DROP 掉旧的 recommendlist / likelist 表,
-- 数据会先迁移到新 article 表。如果你需要保留原始 SQL,请提前备份。
-- ============================================================

CREATE DATABASE IF NOT EXISTS `item_01`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `item_01`;

-- ============================================================
-- 1. userlist
-- ============================================================
CREATE TABLE IF NOT EXISTS `userlist` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(64) NOT NULL,
  `password` VARCHAR(255) NOT NULL COMMENT 'bcrypt hash',
  `confirmpassword` VARCHAR(255) DEFAULT NULL,
  `phone` VARCHAR(20) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`),
  UNIQUE KEY `uk_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 2. category —— 内容分类
-- ============================================================
DROP TABLE IF EXISTS `article_like`;
DROP TABLE IF EXISTS `article`;
DROP TABLE IF EXISTS `category`;
CREATE TABLE `category` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(32) NOT NULL,
  `slug` VARCHAR(32) NOT NULL,
  `icon` VARCHAR(8) DEFAULT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `category` (`name`, `slug`, `icon`, `sort_order`) VALUES
  ('全部动态',  'all',    '📰', 0),
  ('关注',      'focus',  '⭐', 1),
  ('校招就业',  'campus', '💼', 2),
  ('考研考公',  'grad',   '📚', 3),
  ('考级考证',  'cert',   '🎓', 4),
  ('学生竞赛',  'match',  '🏆', 5),
  ('创新创业',  'innov',  '🚀', 6);

-- ============================================================
-- 3. article —— 合并 recommendlist + likelist
-- ============================================================
CREATE TABLE `article` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(200) DEFAULT NULL,
  `content` MEDIUMTEXT NOT NULL,
  `excerpt` VARCHAR(500) DEFAULT NULL,
  `cover_url` VARCHAR(500) DEFAULT NULL,
  `category_id` INT UNSIGNED DEFAULT NULL,
  `author_id` INT UNSIGNED DEFAULT NULL,
  `author_name` VARCHAR(64) DEFAULT NULL,
  `view_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `like_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `sort_type` ENUM('recommend', 'latest') NOT NULL DEFAULT 'latest',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_category` (`category_id`),
  KEY `idx_sort_type` (`sort_type`),
  KEY `idx_created` (`created_at`),
  CONSTRAINT `fk_article_category` FOREIGN KEY (`category_id`) REFERENCES `category` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 全新初始化的种子数据(旧表迁移在 migrate.sql 里单独处理)
INSERT INTO `article`
  (title, content, excerpt, cover_url, category_id, author_name, view_count, like_count, sort_type) VALUES
  ('字节 HR 面经',
    '<h2>面试流程</h2><p>字节 HR 面通常最后一轮,主要看性格匹配。</p><h2>常见问题</h2><ol><li>为什么选择字节?</li><li>说一段你的挫败经历</li><li>你的职业规划是什么?</li></ol><p>建议准备两个失败案例,一个讲原因、一个讲改进。</p>',
    '字节 HR 面的常见问题与答题思路,建议准备两个失败案例', '/BOSS/1.jpg',
    (SELECT id FROM category WHERE slug = 'campus'), '移动应用开发实验室', 26000, 1000, 'recommend'),
  ('腾讯前端一面',
    '<h2>考察重点</h2><p>主要考察 CSS、Vue 响应式原理、事件循环。</p><h2>Vue 响应式</h2><p>Proxy 拦截 → 依赖收集 → 触发更新,这条链路要能画出来。</p>',
    '主要考察 CSS、Vue 响应式原理、事件循环', '/BOSS/2.jpg',
    (SELECT id FROM category WHERE slug = 'campus'), '前端小课堂', 18000, 856, 'recommend'),
  ('美团后端二面',
    '<h2>算法</h2><p>LRU、字符串处理。</p><h2>八股</h2><p>Redis 持久化、MySQL 隔离级别。八股每一段要有实际项目支撑。</p>',
    '算法 + 八股,重点在项目支撑', '/BOSS/4.webp',
    (SELECT id FROM category WHERE slug = 'campus'), 'Java 老张', 15000, 720, 'recommend'),
  ('阿里 P6 转正答辩',
    '<h2>三条主线</h2><ol><li>业务价值</li><li>技术难点</li><li>协作贡献</li></ol><p>每条准备 2 个 STAR 案例。</p>',
    '答辩重点 STAR 案例', '/BOSS/3.jpg',
    (SELECT id FROM category WHERE slug = 'campus'), '大厂追梦人', 12000, 612, 'recommend'),
  ('京东产品实习心得',
    '<p>如何在两个月做出可上线的功能:定义指标 → 快速原型 → 灰度 → 复盘。</p>',
    '两个月实习方法论', '/BOSS/5.jpg',
    (SELECT id FROM category WHERE slug = 'campus'), '产品菜鸟', 9000, 480, 'recommend'),
  ('百度算法工程师之路',
    '<p>从 leetcode 到大厂 offer 的完整路径:基础 500 题 + 精选 100 题 + 面经复盘。</p>',
    '从 leetcode 到大厂 offer', '/BOSS/6.jpg',
    (SELECT id FROM category WHERE slug = 'campus'), 'AI 探索者', 20000, 923, 'recommend'),
  ('2025 考研备考全攻略',
    '<h2>英语</h2><p>从 8 月开始每天 40 分钟真题。</p><h2>数学</h2><p>6 月开始基础第一遍。</p>',
    '英语数学是拉分项,提前铺开', '/BOSS/1.jpg',
    (SELECT id FROM category WHERE slug = 'grad'), '考研过来人', 8500, 320, 'latest'),
  ('CSS 新特性预览',
    '<p>2025 会火的新语法:@container、subgrid、has()。</p>',
    '2025 会火的新语法', '/BOSS/3.jpg',
    (SELECT id FROM category WHERE slug = 'innov'), '前端观察员', 3000, 189, 'latest'),
  ('考研数学冲刺技巧',
    '<p>最后一个月怎么提分:回归错题、每天两套模拟。</p>',
    '最后一个月怎么提分', '/BOSS/2.jpg',
    (SELECT id FROM category WHERE slug = 'grad'), '考研过来人', 4000, 267, 'latest'),
  ('最新招聘动态',
    '<p>各大厂 12 月招聘信息汇总。</p>',
    '各大厂招聘信息汇总', '/BOSS/1.jpg',
    (SELECT id FROM category WHERE slug = 'campus'), '招聘助手', 5000, 320, 'latest');

-- ============================================================
-- 4. article_like —— 点赞关系
-- ============================================================
CREATE TABLE `article_like` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `article_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_article_user` (`article_id`, `user_id`),
  KEY `idx_user` (`user_id`),
  CONSTRAINT `fk_like_article` FOREIGN KEY (`article_id`) REFERENCES `article` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_like_user` FOREIGN KEY (`user_id`) REFERENCES `userlist` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 5. comment —— 加 article_id
-- ============================================================
DROP TABLE IF EXISTS `comment`;
CREATE TABLE `comment` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `article_id` INT UNSIGNED DEFAULT NULL,
  `user_id` INT UNSIGNED DEFAULT NULL,
  `userName` VARCHAR(64) NOT NULL COMMENT '兼容旧接口,新代码用 user_id join userlist',
  `content` TEXT NOT NULL,
  `like` INT UNSIGNED NOT NULL DEFAULT 0,
  `time` BIGINT DEFAULT NULL COMMENT '毫秒时间戳(兼容前端旧字段)',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_article` (`article_id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_username` (`userName`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `comment` (`article_id`, `userName`, `content`, `like`, `time`) VALUES
  (1, 'aq1',   '这篇非常干货,收藏了!',           128, UNIX_TIMESTAMP(NOW() - INTERVAL 3 DAY) * 1000),
  (1, 'aq1',   'HR 面确实这些问题一直在问',         67,  UNIX_TIMESTAMP(NOW() - INTERVAL 1 DAY) * 1000),
  (1, 'zhang', '楼主能分享下你的失败案例吗?',      45,  UNIX_TIMESTAMP(NOW() - INTERVAL 6 HOUR) * 1000),
  (2, 'zhang', '响应式那部分讲得清楚,受教了',      89,  UNIX_TIMESTAMP(NOW() - INTERVAL 5 DAY) * 1000),
  (2, 'li',    '事件循环再多点例子就完美了',         56,  UNIX_TIMESTAMP(NOW() - INTERVAL 2 DAY) * 1000);

-- ============================================================
-- 6. layoutlist / message / chatmessages —— 保留
-- ============================================================
CREATE TABLE IF NOT EXISTS `layoutlist` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bang1` VARCHAR(255) DEFAULT NULL,
  `bang2` VARCHAR(255) DEFAULT NULL,
  `bang3` VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `layoutlist` (`bang1`, `bang2`, `bang3`)
SELECT * FROM (
  SELECT '2025 考研备考全攻略' AS b1, '张老师' AS b2, '#字节跳动秋招面试题#' AS b3
  UNION ALL SELECT '前端秋招面试真题合集', '李老师', '#校招大牛七战字节收割 SSP#'
  UNION ALL SELECT 'MySQL 索引原理详解',   '王同学', '#我的 Java 后端之旅#'
  UNION ALL SELECT 'Vue3 + Vite 实战项目',  '赵学长', '#双非本科如何冲刺大厂#'
  UNION ALL SELECT '高效学习方法论',         '孙学姐', '#研究生复试经验分享#'
) AS s
WHERE NOT EXISTS (SELECT 1 FROM `layoutlist` LIMIT 1);

CREATE TABLE IF NOT EXISTS `message` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sender_id` VARCHAR(64) NOT NULL,
  `receiver_id` VARCHAR(64) NOT NULL,
  `content` TEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `chatmessages` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` VARCHAR(64) NOT NULL,
  `type` ENUM('user', 'ai') NOT NULL,
  `text` TEXT NOT NULL,
  `timestamp` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_time` (`user_id`, `timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 清理旧表(如存在)
DROP TABLE IF EXISTS `recommendlist`;
DROP TABLE IF EXISTS `likelist`;

SELECT 'schema v2 init done' AS status,
       (SELECT COUNT(*) FROM article)    AS articles,
       (SELECT COUNT(*) FROM category)   AS categories,
       (SELECT COUNT(*) FROM comment)    AS comments;
