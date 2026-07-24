// @vitest-environment node
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { LobeChatDatabase } from '../../type';
import { DrizzleMigrationModel } from '../drizzleMigration';

const serverDB: LobeChatDatabase = await getTestDB();

const drizzleMigrationModel = new DrizzleMigrationModel(serverDB);

const topicCommentMigration = readMigrationFiles({
  migrationsFolder: path.join(__dirname, '../../../migrations'),
}).find((migration) =>
  migration.sql.some((statement) =>
    statement.includes('Topic Comments had one shared pre-release'),
  ),
);

if (!topicCommentMigration) throw new Error('Topic Comment migration not found');

const setupTopicCommentMigrationDependencies = async (client: PGlite) => {
  await client.exec(`
    CREATE TABLE users (id text PRIMARY KEY);
    CREATE TABLE workspaces (id text PRIMARY KEY);
    CREATE TABLE topics (id text PRIMARY KEY);
    CREATE TABLE messages (id text PRIMARY KEY);
    CREATE TABLE rbac_permissions (
      id text PRIMARY KEY,
      code text NOT NULL UNIQUE,
      name text NOT NULL,
      description text,
      category text NOT NULL,
      is_active boolean DEFAULT true NOT NULL,
      accessed_at timestamp with time zone DEFAULT now() NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE rbac_roles (
      id text PRIMARY KEY,
      name text NOT NULL,
      display_name text NOT NULL,
      description text,
      is_system boolean DEFAULT false NOT NULL,
      is_active boolean DEFAULT true NOT NULL,
      metadata jsonb DEFAULT '{}'::jsonb,
      workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE,
      accessed_at timestamp with time zone DEFAULT now() NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE rbac_role_permissions (
      role_id text NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
      permission_id text NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY (role_id, permission_id)
    );

    INSERT INTO workspaces (id) VALUES ('migration-workspace');
    INSERT INTO rbac_roles (id, name, display_name, is_system, workspace_id) VALUES
      ('owner-role', 'workspace_owner', 'Owner', true, 'migration-workspace'),
      ('member-role', 'workspace_member', 'Member', true, 'migration-workspace'),
      ('viewer-role', 'workspace_viewer', 'Viewer', true, 'migration-workspace'),
      ('custom-role', 'custom_editor', 'Custom Editor', false, 'migration-workspace'),
      -- Legacy super_admin rows may predate the is_system flag.
      ('super-admin-role', 'super_admin', 'Super Admin', false, NULL);
  `);
};

const runTopicCommentMigration = async (client: PGlite) => {
  for (const statement of topicCommentMigration.sql) await client.exec(statement);
};

const downgradeTopicCommentsToSharedDraft = async (client: PGlite) => {
  await client.exec(`
    DROP INDEX topic_comments_moderation_expires_at_idx;
    DROP INDEX topic_comments_moderated_by_user_id_idx;
    ALTER TABLE topic_comments DROP CONSTRAINT topic_comments_moderation_window_consistent;
    ALTER TABLE topic_comments DROP CONSTRAINT topic_comments_deleted_not_recoverable;
    ALTER TABLE topic_comments DROP CONSTRAINT topic_comments_moderated_by_user_id_users_id_fk;
    ALTER TABLE topic_comments DROP COLUMN moderated_at;
    ALTER TABLE topic_comments DROP COLUMN moderated_by_user_id;
    ALTER TABLE topic_comments DROP COLUMN moderation_expires_at;
  `);
};

describe('DrizzleMigrationModel', () => {
  beforeEach(async () => {
    // Clean up database before each test if needed
  });

  describe('getTableCounts', () => {
    it('should return table count from information_schema', async () => {
      const count = await drizzleMigrationModel.getTableCounts();

      expect(count).toBeTypeOf('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should return integer value', async () => {
      const count = await drizzleMigrationModel.getTableCounts();

      expect(Number.isInteger(count)).toBe(true);
    });
  });

  describe('getMigrationList', () => {
    it('should return migration list', async () => {
      const migrations = await drizzleMigrationModel.getMigrationList();

      expect(Array.isArray(migrations)).toBe(true);
    });

    it('should return migration items with required fields', async () => {
      const migrations = await drizzleMigrationModel.getMigrationList();

      migrations.forEach((migration) => {
        expect(migration).toHaveProperty('hash');
        expect(migration).toHaveProperty('created_at');
        expect(typeof migration.hash).toBe('string');
      });
    });
  });

  describe('getLatestMigrationHash', () => {
    it('should return the hash of the latest migration', async () => {
      const hash = await drizzleMigrationModel.getLatestMigrationHash();
      const migrations = await drizzleMigrationModel.getMigrationList();

      if (migrations.length > 0) {
        expect(hash).toBe(migrations[0].hash);
        expect(typeof hash).toBe('string');
      }
    });

    it('should return the first item hash from migration list', async () => {
      const migrations = await drizzleMigrationModel.getMigrationList();

      if (migrations.length > 0) {
        const latestHash = await drizzleMigrationModel.getLatestMigrationHash();
        expect(latestHash).toBe(migrations[0].hash);
      }
    });
  });
});

describe('0127 Topic Comment migration', () => {
  it('creates a fresh schema and idempotently backfills only built-in role grants', async () => {
    const client = new PGlite();

    try {
      await setupTopicCommentMigrationDependencies(client);
      await runTopicCommentMigration(client);
      await runTopicCommentMigration(client);

      const columns = await client.query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'topic_comments'
      `);
      expect(columns.rows.map(({ column_name }) => column_name)).toEqual(
        expect.arrayContaining(['moderated_at', 'moderated_by_user_id', 'moderation_expires_at']),
      );

      const grants = await client.query<{ grant_count: number; role_name: string }>(`
        SELECT role.name AS role_name, count(*)::int AS grant_count
        FROM rbac_roles role
        JOIN rbac_role_permissions role_permission ON role_permission.role_id = role.id
        JOIN rbac_permissions permission ON permission.id = role_permission.permission_id
        WHERE permission.code LIKE 'topic_comment:%'
        GROUP BY role.name
      `);
      expect(
        Object.fromEntries(grants.rows.map((row) => [row.role_name, row.grant_count])),
      ).toEqual({
        super_admin: 5,
        workspace_member: 4,
        workspace_owner: 5,
        workspace_viewer: 1,
      });

      const permissions = await client.query<{ permission_count: number }>(`
        SELECT count(*)::int AS permission_count
        FROM rbac_permissions
        WHERE code LIKE 'topic_comment:%'
      `);
      expect(permissions.rows[0].permission_count).toBe(8);
    } finally {
      await client.close();
    }
  });

  it('upgrades the exact shared draft without losing its comments', async () => {
    const client = new PGlite();

    try {
      await setupTopicCommentMigrationDependencies(client);
      await runTopicCommentMigration(client);
      await downgradeTopicCommentsToSharedDraft(client);
      await client.exec(`
        INSERT INTO users (id) VALUES ('draft-author');
        INSERT INTO topics (id) VALUES ('draft-topic');
        INSERT INTO topic_comments (
          id, topic_id, author_user_id, workspace_id, content, client_id
        ) VALUES (
          'draft-comment', 'draft-topic', 'draft-author', 'migration-workspace', 'keep me', 'draft-client'
        );
      `);

      await runTopicCommentMigration(client);

      const comments = await client.query<{ content: string; moderated_at: Date | null }>(`
        SELECT content, moderated_at FROM topic_comments WHERE id = 'draft-comment'
      `);
      expect(comments.rows).toEqual([{ content: 'keep me', moderated_at: null }]);
    } finally {
      await client.close();
    }
  });

  it('rejects an unknown draft shape before applying any mutation', async () => {
    const client = new PGlite();

    try {
      await setupTopicCommentMigrationDependencies(client);
      await runTopicCommentMigration(client);
      await downgradeTopicCommentsToSharedDraft(client);
      await client.exec('ALTER TABLE topic_comments ALTER COLUMN content DROP NOT NULL;');

      await expect(runTopicCommentMigration(client)).rejects.toThrow(
        'unsupported topic_comments column shape',
      );

      const moderationColumns = await client.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'topic_comments'
          AND column_name IN ('moderated_at', 'moderated_by_user_id', 'moderation_expires_at')
      `);
      expect(moderationColumns.rows[0].count).toBe(0);
    } finally {
      await client.close();
    }
  });
});
