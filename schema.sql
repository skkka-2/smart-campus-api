-- ============================================================
-- smart-campus-api 数据库初始化脚本
-- ============================================================
-- 使用方法:
--   mysql -u root -p < schema.sql
-- 或在 Sequel Ace 里粘贴执行
--
-- 注意:所有 !!GUESS!! 标注的字段/长度都是根据代码反推的,
--       如果和你原始库不一致,请修改后重新执行。
-- ============================================================

CREATE DATABASE IF NOT EXISTS `item_01`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `item_01`;

-- ============================================================
-- 1. userlist —— 用户表(注册/登录)
-- ============================================================
DROP TABLE IF EXISTS `userlist`;
CREATE TABLE `userlist` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(64) NOT NULL,
  `password` VARCHAR(255) NOT NULL COMMENT 'bcrypt hash',
  `confirmpassword` VARCHAR(255) DEFAULT NULL COMMENT '!!GUESS!! 代码里存了这一字段,实际上不该入库',
  `phone` VARCHAR(20) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`),
  UNIQUE KEY `uk_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 2. layoutlist —— 首页右侧三个榜单(文章榜/作者榜/推荐话题)
-- 代码位置:server/router_handler/layout.js -> exports.titbang
-- ============================================================
DROP TABLE IF EXISTS `layoutlist`;
CREATE TABLE `layoutlist` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bang1` VARCHAR(255) DEFAULT NULL COMMENT '文章榜条目',
  `bang2` VARCHAR(255) DEFAULT NULL COMMENT '作者榜条目',
  `bang3` VARCHAR(255) DEFAULT NULL COMMENT '推荐话题',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 种子数据
INSERT INTO `layoutlist` (`bang1`, `bang2`, `bang3`) VALUES
  ('2025 考研备考全攻略',           '张老师',   '#字节跳动秋招面试题#'),
  ('前端秋招面试真题合集',           '李老师',   '#校招大牛七战字节收割 SSP#'),
  ('MySQL 索引原理详解',            '王同学',   '#我的 Java 后端之旅#'),
  ('Vue3 + Vite 实战项目',          '赵学长',   '#双非本科如何冲刺大厂#'),
  ('高效学习方法论',                '孙学姐',   '#研究生复试经验分享#');

-- ============================================================
-- 3. recommendlist —— 推荐文章列表(首页中间流)
-- 代码位置:layout.js -> exports.mid、exports.upload
-- 前端字段:content.vue 期望 { title, cont, picUrl, like, view, user }
-- ============================================================
DROP TABLE IF EXISTS `recommendlist`;
CREATE TABLE `recommendlist` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(200) DEFAULT NULL,
  `cont` TEXT DEFAULT NULL COMMENT '正文/摘要,upload 接口写这一字段',
  `picUrl` VARCHAR(500) DEFAULT NULL,
  `like` INT DEFAULT 0,
  `view` VARCHAR(20) DEFAULT '0' COMMENT '!!GUESS!! 前端期望字符串(如 26k)',
  `user` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `recommendlist` (`title`, `cont`, `picUrl`, `like`, `view`, `user`) VALUES
  ('字节 HR 面经',        '字节 HR 面的常见问题与答题思路,建议准备两个失败案例',  '/BOSS/1.jpg', 1000, '26k', '移动应用开发实验室'),
  ('腾讯前端一面',        '主要考察 CSS、Vue 响应式原理、事件循环',                 '/BOSS/2.jpg', 856,  '18k', '前端小课堂'),
  ('美团后端二面',        '算法题:LRU、字符串处理;八股:Redis 持久化、MySQL 隔离级别', '/BOSS/4.webp', 720,  '15k', 'Java 老张'),
  ('阿里 P6 转正答辩',    '答辩重点:业务价值、技术难点、协作贡献',                   '/BOSS/3.jpg', 612,  '12k', '大厂追梦人'),
  ('京东产品实习心得',    '如何在两个月做出可上线的功能',                            '/BOSS/5.jpg', 480,  '9k',  '产品菜鸟'),
  ('百度算法工程师之路',  '从 leetcode 到大厂 offer 的完整路径',                     '/BOSS/6.jpg', 923,  '20k', 'AI 探索者');

-- ============================================================
-- 4. likelist —— "最新" tab 显示的列表
-- 代码位置:layout.js -> exports.mid2
-- 结构和 recommendlist 一致(前端复用 content.vue)
-- ============================================================
DROP TABLE IF EXISTS `likelist`;
CREATE TABLE `likelist` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(200) DEFAULT NULL,
  `cont` TEXT DEFAULT NULL,
  `picUrl` VARCHAR(500) DEFAULT NULL,
  `like` INT DEFAULT 0,
  `view` VARCHAR(20) DEFAULT '0',
  `user` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `likelist` (`title`, `cont`, `picUrl`, `like`, `view`, `user`) VALUES
  ('最新招聘动态',       '各大厂 12 月招聘信息汇总',       '/BOSS/1.jpg', 320, '5k',  '招聘助手'),
  ('考研数学冲刺技巧',   '最后一个月怎么提分',             '/BOSS/2.jpg', 267, '4k',  '考研过来人'),
  ('CSS 新特性预览',     '2025 会火的新语法',              '/BOSS/3.jpg', 189, '3k',  '前端观察员');

-- ============================================================
-- 5. message —— 聊天室历史消息
-- 代码位置:websocket.js;layout.js -> chatRoomHistory
-- ============================================================
DROP TABLE IF EXISTS `message`;
CREATE TABLE `message` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sender_id` VARCHAR(64) NOT NULL,
  `receiver_id` VARCHAR(64) NOT NULL COMMENT '群聊时后端硬编码为 1',
  `content` TEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 6. chatmessages —— AI 对话历史
-- 代码位置:layout.js -> saveMessage、getMessages
-- ============================================================
DROP TABLE IF EXISTS `chatmessages`;
CREATE TABLE `chatmessages` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` VARCHAR(64) NOT NULL,
  `type` ENUM('user', 'ai') NOT NULL,
  `text` TEXT NOT NULL,
  `timestamp` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '!!GUESS!! 代码里 ORDER BY timestamp ASC',
  PRIMARY KEY (`id`),
  KEY `idx_user_time` (`user_id`, `timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 7. comment —— 评论区
-- 代码位置:router_handler/comment.js(已删除的旧文件),
--          但前端仍会调用 /comment
--          目前后端未注册 comment 路由,这张表是给后续接入准备的
-- 前端 comment.vue 期望字段:{ userName, time, like, content }
-- ============================================================
DROP TABLE IF EXISTS `comment`;
CREATE TABLE `comment` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `userName` VARCHAR(64) NOT NULL,
  `content` TEXT NOT NULL,
  `like` INT DEFAULT 0,
  `time` BIGINT DEFAULT NULL COMMENT '!!GUESS!! 前端用 Number(props.time) 处理,应该是毫秒时间戳',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_username` (`userName`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `comment` (`userName`, `content`, `like`, `time`) VALUES
  ('aq1', '这个平台真棒,推荐给同学!',           128, UNIX_TIMESTAMP(NOW() - INTERVAL 3 DAY) * 1000),
  ('aq1', '希望能加更多前端相关的内容',         67,  UNIX_TIMESTAMP(NOW() - INTERVAL 1 DAY) * 1000),
  ('aq1', '客服欣欣老师回复很快,给个赞',         89,  UNIX_TIMESTAMP(NOW() - INTERVAL 6 HOUR) * 1000);

-- ============================================================
-- 完成
-- ============================================================
SELECT 'schema init done' AS status;
