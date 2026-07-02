import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { agents } from '../schemas/agent';
import { buildWorkspacePayload, buildWorkspaceWhere } from './workspace';

describe('workspace utils', () => {
  describe('buildWorkspaceWhere', () => {
    it('scopes personal reads by user and null workspace', () => {
      const condition = buildWorkspaceWhere({ userId: 'user-1' }, agents);
      const built = new PgDialect().sqlToQuery(condition);

      expect(built.sql).toBe('("agents"."user_id" = $1 and "agents"."workspace_id" is null)');
      expect(built.params).toStrictEqual(['user-1']);
    });

    it('scopes workspace reads by workspace id only', () => {
      const condition = buildWorkspaceWhere({ userId: 'user-1', workspaceId: 'ws-1' }, agents);
      const built = new PgDialect().sqlToQuery(condition);

      expect(built.sql).toBe('"agents"."workspace_id" = $1');
      expect(built.params).toStrictEqual(['ws-1']);
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
