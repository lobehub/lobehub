PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_projection_home_indexes` (
	`data` text NOT NULL,
	`key` text NOT NULL,
	`observed_at` integer NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`scope` text NOT NULL,
	`source` text NOT NULL,
	`storage_id` text PRIMARY KEY NOT NULL,
	CONSTRAINT "projection_home_indexes_data_json" CHECK(json_valid("__new_projection_home_indexes"."data")),
	CONSTRAINT "projection_home_indexes_key_valid" CHECK("__new_projection_home_indexes"."key" IN ('agent.available', 'agent.directory', 'chatGroup.list', 'home.inboxTopics', 'home.recentTopics', 'home.scheduledTasks', 'home.sidebar', 'home.tasks', 'home.unresolvedBriefs') OR "__new_projection_home_indexes"."key" LIKE 'agent.search:%' OR "__new_projection_home_indexes"."key" LIKE 'brief.news:%' OR "__new_projection_home_indexes"."key" LIKE 'chat.agentViewTopics:%' OR "__new_projection_home_indexes"."key" LIKE 'chat.sidebarTopics:%' OR "__new_projection_home_indexes"."key" LIKE 'task.groupList:%' OR "__new_projection_home_indexes"."key" LIKE 'task.list:%'),
	CONSTRAINT "projection_home_indexes_observed_at_positive" CHECK("__new_projection_home_indexes"."observed_at" >= 0),
	CONSTRAINT "projection_home_indexes_schema_version_current" CHECK("__new_projection_home_indexes"."schema_version" = 1),
	CONSTRAINT "projection_home_indexes_source_valid" CHECK("__new_projection_home_indexes"."source" IN ('mutation', 'network', 'realtime'))
);
--> statement-breakpoint
INSERT INTO `__new_projection_home_indexes`("data", "key", "observed_at", "schema_version", "scope", "source", "storage_id") SELECT "data", "key", "observed_at", "schema_version", "scope", "source", "storage_id" FROM `projection_home_indexes`;--> statement-breakpoint
DROP TABLE `projection_home_indexes`;--> statement-breakpoint
ALTER TABLE `__new_projection_home_indexes` RENAME TO `projection_home_indexes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `projection_home_indexes_scope_key_unique` ON `projection_home_indexes` (`scope`,`key`);--> statement-breakpoint
CREATE INDEX `projection_home_indexes_scope_idx` ON `projection_home_indexes` (`scope`);
