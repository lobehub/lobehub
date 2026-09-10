import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { agents } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { createPgSearchFtsSearchContext } from './scope';

describe('createPgSearchFtsSearchContext', () => {
  it('keeps the trash predicate inside a personal-mode candidate scan', () => {
    const context = createPgSearchFtsSearchContext({} as LobeChatDatabase, {
      userId: 'user-1',
    });
    const built = new PgDialect().sqlToQuery(context.scanScopeWhere(agents));

    expect(built.sql).toBe('("agents"."user_id" = $1 and "agents"."is_deleted" IS NOT TRUE)');
    expect(built.params).toStrictEqual(['user-1']);
    expect(context.liftedScopeWhere(agents.workspaceId)).toBeDefined();
  });
});
