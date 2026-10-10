import { alias, PgDialect } from 'drizzle-orm/pg-core';
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

    it('treats a blank workspace id as personal scope rather than as a workspace', () => {
      // Reads already collapsed `''` because it is falsy. Pinning it keeps a
      // future refactor of the predicate from turning a blank scope into
      // `workspace_id = ''`, which matches nothing.
      const condition = buildWorkspaceWhere(
        { includeTrashed: true, userId: 'user-1', workspaceId: '' },
        agents,
      );
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
    it('adds `is_deleted IS NOT TRUE` when the cols carry the trash-aware flag', () => {
      // Every ownership-scoped read of a trash-aware table (agents, topics,
      // files, …) must hide rows sitting in the recycle bin — without the
      // ~250 call sites opting in one by one.
      const condition = buildWorkspaceWhere({ userId: 'user-1' }, agents);
      const built = new PgDialect().sqlToQuery(condition);

      expect(built.sql).toBe(
        '(("agents"."user_id" = $1 and "agents"."workspace_id" is null) and "agents"."is_deleted" IS NOT TRUE)',
      );
      expect(built.params).toStrictEqual(['user-1']);
    });

    it('is `IS NOT TRUE`, not `= false`, because a live row leaves the flag NULL', () => {
      // `is_deleted = false` is NULL for an unstamped row — not true — so an
      // equality filter would hide the entire table instead of its trashed rows.
      const built = new PgDialect().sqlToQuery(buildWorkspaceWhere({ userId: 'user-1' }, agents));

      expect(built.sql).not.toContain('"is_deleted" = ');
    });

    it('applies the stamp filter in workspace mode too', () => {
      const condition = buildWorkspaceWhere({ userId: 'user-1', workspaceId: 'ws-1' }, agents);
      const built = new PgDialect().sqlToQuery(condition);

      expect(built.sql).toContain('"agents"."is_deleted" IS NOT TRUE');
      expect(built.sql.startsWith('(("agents"."workspace_id" = $1')).toBe(true);
    });

    it('recognizes a trash-aware table through a Drizzle alias', () => {
      const aliasedAgents = alias(agents, 'candidate_agents');
      const condition = buildWorkspaceWhere({ userId: 'user-1' }, aliasedAgents);
      const built = new PgDialect().sqlToQuery(condition);

      expect(built.sql).toContain('"candidate_agents"."is_deleted" IS NOT TRUE');
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

    /**
     * @example A caller hands over a scope it "resolved" into `''`.
     */
    it('treats a blank workspace id as personal instead of writing a scope that cannot exist', () => {
      // ROOT CAUSE:
      //
      // An empty scope is not a workspace. Whatever turns "no workspace" into
      // `''` — an empty header, an env var that is present but blank, a `?? ''`
      // on the way through a caller — the payload was written as
      // `workspace_id: ''`, which the foreign key to `workspaces` rejects. The
      // statement then fails whole, so nothing in that batch is persisted.
      //
      // Before: `''` was written through verbatim.
      // After: blank collapses to `null`, i.e. personal data.
      const personal = { title: 'Personal agent', userId: 'user-1', workspaceId: null };

      expect(
        buildWorkspacePayload({ userId: 'user-1', workspaceId: '' }, { title: 'Personal agent' }),
      ).toEqual(personal);
      expect(
        buildWorkspacePayload(
          { userId: 'user-1', workspaceId: '   ' },
          { title: 'Personal agent' },
        ),
      ).toEqual(personal);
      expect(
        buildWorkspacePayload({ userId: 'user-1', workspaceId: null }, { title: 'Personal agent' }),
      ).toEqual(personal);
    });

    it('trims a padded workspace id rather than writing it unreadable', () => {
      expect(
        buildWorkspacePayload({ userId: 'user-1', workspaceId: ' ws-1 ' }, { title: 'Team agent' }),
      ).toEqual({
        title: 'Team agent',
        userId: 'user-1',
        workspaceId: 'ws-1',
      });
    });
  });
});
