import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { agents } from '../../../schemas/agent';
import { pgSearchDialect } from './dialect';

const render = (query: Parameters<PgDialect['sqlToQuery']>[0]) => new PgDialect().sqlToQuery(query);

describe('pgSearchDialect', () => {
  it('keeps the ParadeDB match and score shape', () => {
    const fields = [{ column: agents.title }, { column: agents.description }];
    const prepared = pgSearchDialect.prepare('kube');

    const match = render(pgSearchDialect.match(fields, prepared));
    expect(match.sql).toBe('("agents"."title" @@@ $1 OR "agents"."description" @@@ $2)');
    expect(match.params).toEqual([prepared, prepared]);

    const score = render(pgSearchDialect.score(agents.id, fields, prepared));
    expect(score.sql).toBe('paradedb.score("agents"."id")');
  });
});
