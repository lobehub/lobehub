import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { agents } from '../schemas/agent';
import { agentDocuments } from '../schemas/agentDocuments';
import { topicComments } from '../schemas/topicComment';
import { buildWorkspacePayload, buildWorkspaceWhere } from './workspace';

describe('workspace utils', () => {
  describe('buildWorkspaceWhere', () => {
    it('scopes personal reads by user and null workspace (visibility ignored)', () => {
      // Personal mode rows are implicitly owner-private, so the visibility
      // column is intentionally not part of the predicate.
      const condition = buildWorkspaceWhere({ includeTrashed: true, userId: 'user-1' }, agents);
      const built = new PgDialect().sqlToQuery(condition);

      expect(built.sql).toBe('("agents"."user_id" = $1 and "agents"."workspace_id" is null)');
      expect(built.params).toStrictEqual(['user-1']);
    });

    it('scopes workspace reads with visibility filter when the column is present', () => {
      const condition = buildWorkspaceWhere(
        { includeTrashed: true, userId: 'user-1', workspaceId: 'ws-1' },
        agents,
      );
      const built = new PgDialect().sqlToQuery(condition);

      // Workspace mode: every member sees public rows; private rows are
      // restricted to their creator. NULL is treated as public for backwards
      // compatibility with rows that pre-date the `visibility` column.
      expect(built.sql).toBe(
        '("agents"."workspace_id" = $1 and ("agents"."visibility" is null or "agents"."visibility" = $2 or ("agents"."visibility" = $3 and "agents"."user_id" = $4)))',
      );
      expect(built.params).toStrictEqual(['ws-1', 'public', 'private', 'user-1']);
    });

    it('omits visibility filter when the cols object has no visibility column', () => {
      const condition = buildWorkspaceWhere(
        { userId: 'user-1', workspaceId: 'ws-1' },
        { userId: agents.userId, workspaceId: agents.workspaceId },
      );
      const built = new PgDialect().sqlToQuery(condition);

      expect(built.sql).toBe('"agents"."workspace_id" = $1');
      expect(built.params).toStrictEqual(['ws-1']);
    });

    it('drops the caller-private branch when the executing agent is public', () => {
      // Public-agent gate: mirrors task's `assertAgentVisibilityCompat` — a
      // workspace-shared agent must not read the caller's own private rows
      // even though it runs under the caller's session.
      const condition = buildWorkspaceWhere(
        {
          callerAgentVisibility: 'public',
          includeTrashed: true,
          userId: 'user-1',
          workspaceId: 'ws-1',
        },
        agents,
      );
      const built = new PgDialect().sqlToQuery(condition);

      expect(built.sql).toBe(
        '("agents"."workspace_id" = $1 and ("agents"."visibility" is null or "agents"."visibility" = $2))',
      );
      expect(built.params).toStrictEqual(['ws-1', 'public']);
    });

    it('keeps the caller-private branch when the executing agent is private', () => {
      // Private agents run under their owner's session — they should retain
      // read access to that owner's private rows.
      const condition = buildWorkspaceWhere(
        {
          callerAgentVisibility: 'private',
          includeTrashed: true,
          userId: 'user-1',
          workspaceId: 'ws-1',
        },
        agents,
      );
      const built = new PgDialect().sqlToQuery(condition);

      expect(built.sql).toBe(
        '("agents"."workspace_id" = $1 and ("agents"."visibility" is null or "agents"."visibility" = $2 or ("agents"."visibility" = $3 and "agents"."user_id" = $4)))',
      );
      expect(built.params).toStrictEqual(['ws-1', 'public', 'private', 'user-1']);
    });

    it('leaves the standard filter in place when callerAgentVisibility is null (unresolved)', () => {
      // Null means the caller isn't a tool runtime or the agent could not be
      // resolved. Fall through to the standard "public + own-private" filter.
      const condition = buildWorkspaceWhere(
        {
          callerAgentVisibility: null,
          includeTrashed: true,
          userId: 'user-1',
          workspaceId: 'ws-1',
        },
        agents,
      );
      const built = new PgDialect().sqlToQuery(condition);

      expect(built.sql).toBe(
        '("agents"."workspace_id" = $1 and ("agents"."visibility" is null or "agents"."visibility" = $2 or ("agents"."visibility" = $3 and "agents"."user_id" = $4)))',
      );
      expect(built.params).toStrictEqual(['ws-1', 'public', 'private', 'user-1']);
    });

    it('ignores callerAgentVisibility in personal mode (no workspaceId)', () => {
      // Personal-mode rows are already owner-private by construction; visibility
      // is unused, so the public-agent gate should be a no-op here.
      const condition = buildWorkspaceWhere(
        { callerAgentVisibility: 'public', includeTrashed: true, userId: 'user-1' },
        agents,
      );
      const built = new PgDialect().sqlToQuery(condition);

      expect(built.sql).toBe('("agents"."user_id" = $1 and "agents"."workspace_id" is null)');
      expect(built.params).toStrictEqual(['user-1']);
    });
  });

  describe('recycle-bin filter', () => {
    it('adds `is_deleted = false` when the cols carry the trash-aware flag', () => {
      // Every ownership-scoped read of a trash-aware table (agents, topics,
      // files, …) must hide rows sitting in the recycle bin — without the
      // ~250 call sites opting in one by one.
      const condition = buildWorkspaceWhere({ userId: 'user-1' }, agents);
      const built = new PgDialect().sqlToQuery(condition);

      expect(built.sql).toBe(
        '(("agents"."user_id" = $1 and "agents"."workspace_id" is null) and "agents"."is_deleted" = $2)',
      );
      expect(built.params).toStrictEqual(['user-1', false]);
    });

    it('applies the stamp filter in workspace mode too', () => {
      const condition = buildWorkspaceWhere({ userId: 'user-1', workspaceId: 'ws-1' }, agents);
      const built = new PgDialect().sqlToQuery(condition);

      expect(built.sql).toContain('"agents"."is_deleted" = $5');
      expect(built.sql.startsWith('(("agents"."workspace_id" = $1')).toBe(true);
    });

    it('skips the filter with `includeTrashed` (restore / purge internals)', () => {
      const condition = buildWorkspaceWhere({ includeTrashed: true, userId: 'user-1' }, agents);
      const built = new PgDialect().sqlToQuery(condition);

      expect(built.sql).not.toContain('is_deleted');
    });

    it('does not filter when the cols object omits isDeleted', () => {
      const condition = buildWorkspaceWhere(
        { userId: 'user-1' },
        { userId: agents.userId, workspaceId: agents.workspaceId },
      );
      expect(new PgDialect().sqlToQuery(condition).sql).not.toContain('is_deleted');
    });

    it('does not filter tables whose deleted_at has other semantics', () => {
      // agent_documents / topic_comments / workspace_members use `deleted_at`
      // as a tombstone with their own read rules and carry no `is_deleted` —
      // never auto-filtered, even if a caller wires their column in.
      const condition = buildWorkspaceWhere({ userId: 'user-1' }, agentDocuments);
      expect(new PgDialect().sqlToQuery(condition).sql).not.toContain('deleted');
      const comments = buildWorkspaceWhere(
        { userId: 'user-1', workspaceId: 'ws-1' },
        {
          isDeleted: topicComments.deletedAt,
          userId: topicComments.authorUserId,
          workspaceId: topicComments.workspaceId,
        },
      );
      expect(new PgDialect().sqlToQuery(comments).sql).not.toContain('deleted');
    });
  });

  describe('buildWorkspacePayload', () => {
    it('writes personal payloads with a null workspace id', () => {
      expect(buildWorkspacePayload({ userId: 'user-1' }, { title: 'Personal agent' })).toEqual({
        title: 'Personal agent',
        userId: 'user-1',
        workspaceId: null,
      });
    });

    it('writes workspace payloads with creator and workspace id', () => {
      expect(
        buildWorkspacePayload({ userId: 'user-1', workspaceId: 'ws-1' }, { title: 'Team agent' }),
      ).toEqual({
        title: 'Team agent',
        userId: 'user-1',
        workspaceId: 'ws-1',
      });
    });
  });
});
