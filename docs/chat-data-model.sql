-- SmartCampus chat domain schema.
-- Depends on userlist.id INT UNSIGNED.
-- This file is additive. It does not drop or rewrite the legacy message table.

CREATE TABLE IF NOT EXISTS `chat_conversations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `type` ENUM('hall', 'direct', 'group') NOT NULL,
  `hall_key` VARCHAR(32) DEFAULT NULL,
  `name` VARCHAR(128) DEFAULT NULL,
  `avatar_url` VARCHAR(500) DEFAULT NULL,
  `owner_id` INT UNSIGNED DEFAULT NULL,
  `direct_user_low` INT UNSIGNED DEFAULT NULL,
  `direct_user_high` INT UNSIGNED DEFAULT NULL,
  `status` ENUM('active', 'archived') NOT NULL DEFAULT 'active',
  `last_message_id` BIGINT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_chat_hall` (`hall_key`),
  UNIQUE KEY `uk_chat_direct_pair` (`direct_user_low`, `direct_user_high`),
  KEY `idx_chat_conversation_activity` (`status`, `updated_at`),
  CONSTRAINT `fk_chat_conversation_owner`
    FOREIGN KEY (`owner_id`) REFERENCES `userlist` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE `chat_conversations`
  MODIFY COLUMN `hall_key` VARCHAR(32) DEFAULT NULL;

CREATE TABLE IF NOT EXISTS `chat_conversation_members` (
  `conversation_id` BIGINT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `role` ENUM('owner', 'admin', 'member') NOT NULL DEFAULT 'member',
  `status` ENUM('active', 'left', 'removed') NOT NULL DEFAULT 'active',
  `last_read_message_id` BIGINT UNSIGNED DEFAULT NULL,
  `joined_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_read_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`conversation_id`, `user_id`),
  KEY `idx_chat_member_user` (`user_id`, `status`),
  CONSTRAINT `fk_chat_member_conversation`
    FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_chat_member_user`
    FOREIGN KEY (`user_id`) REFERENCES `userlist` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `chat_messages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `conversation_id` BIGINT UNSIGNED NOT NULL,
  `sender_id` INT UNSIGNED NOT NULL,
  `client_message_id` VARCHAR(64) NOT NULL,
  `type` ENUM('text', 'image', 'system') NOT NULL DEFAULT 'text',
  `content` JSON NOT NULL,
  `reply_to_id` BIGINT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `edited_at` DATETIME DEFAULT NULL,
  `recalled_at` DATETIME DEFAULT NULL,
  `deleted_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_chat_message_client_id` (`sender_id`, `conversation_id`, `client_message_id`),
  KEY `idx_chat_message_history` (`conversation_id`, `id`),
  KEY `idx_chat_message_sender` (`sender_id`, `created_at`),
  CONSTRAINT `fk_chat_message_conversation`
    FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_chat_message_sender`
    FOREIGN KEY (`sender_id`) REFERENCES `userlist` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `chat_friendships` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `requester_id` INT UNSIGNED NOT NULL,
  `addressee_id` INT UNSIGNED NOT NULL,
  `pair_low` INT UNSIGNED NOT NULL,
  `pair_high` INT UNSIGNED NOT NULL,
  `status` ENUM('pending', 'accepted', 'rejected', 'blocked') NOT NULL DEFAULT 'pending',
  `remark` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_chat_friend_pair` (`pair_low`, `pair_high`),
  KEY `idx_chat_friend_requester` (`requester_id`, `status`),
  KEY `idx_chat_friend_addressee` (`addressee_id`, `status`),
  CONSTRAINT `fk_chat_friend_requester`
    FOREIGN KEY (`requester_id`) REFERENCES `userlist` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_chat_friend_addressee`
    FOREIGN KEY (`addressee_id`) REFERENCES `userlist` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `chat_group_invites` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `conversation_id` BIGINT UNSIGNED NOT NULL,
  `inviter_id` INT UNSIGNED NOT NULL,
  `invitee_id` INT UNSIGNED NOT NULL,
  `status` ENUM('pending', 'accepted', 'rejected', 'cancelled', 'expired') NOT NULL DEFAULT 'pending',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_chat_group_invite_pending` (`conversation_id`, `invitee_id`, `status`),
  KEY `idx_chat_group_invitee` (`invitee_id`, `status`),
  CONSTRAINT `fk_chat_group_invite_conversation`
    FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_chat_group_invite_inviter`
    FOREIGN KEY (`inviter_id`) REFERENCES `userlist` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_chat_group_invite_invitee`
    FOREIGN KEY (`invitee_id`) REFERENCES `userlist` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `chat_socket_tickets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `token_hash` BINARY(32) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `used_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_chat_socket_ticket_hash` (`token_hash`),
  KEY `idx_chat_socket_ticket_expiry` (`user_id`, `expires_at`),
  CONSTRAINT `fk_chat_socket_ticket_user`
    FOREIGN KEY (`user_id`) REFERENCES `userlist` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Rows that cannot be safely classified from the legacy message table are kept
-- here for manual review rather than silently assigning the wrong conversation.
CREATE TABLE IF NOT EXISTS `chat_legacy_messages` (
  `legacy_message_id` INT UNSIGNED NOT NULL,
  `sender_id` VARCHAR(64) NOT NULL,
  `receiver_id` VARCHAR(64) NOT NULL,
  `content` TEXT NOT NULL,
  `created_at` DATETIME NOT NULL,
  `migration_status` ENUM('needs_review', 'migrated', 'ignored') NOT NULL DEFAULT 'needs_review',
  `target_message_id` BIGINT UNSIGNED DEFAULT NULL,
  `review_note` VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`legacy_message_id`),
  KEY `idx_chat_legacy_status` (`migration_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
