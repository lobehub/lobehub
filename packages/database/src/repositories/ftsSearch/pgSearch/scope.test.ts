import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { agents } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { createPostgresFtsSearchContext } from '../postgres/context';
import { pgSearchDialect } from './dialect';

describe('createPostgresFtsSearchContext with pg_search', () => {
  it('keeps the trash predicate inside a personal-mode candidate scan', () => {
    const context = createPostgresFtsSearchContext(
      {} as LobeChatDatabase,
      { userId: 'user-1' },
      pgSearchDialect,
    );
    const built = new PgDialect().sqlToQuery(context.scanScopeWhere(agents));

    expect(built.sql).toBe('("agents"."user_id" = $1 and "agents"."is_deleted" IS NOT TRUE)');
    expect(built.params).toStrictEqual(['user-1']);
    expect(context.liftedScopeWhere(agents.workspaceId)).toBeDefined();
  });
});
