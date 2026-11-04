import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { messages } from '../schemas';
import { inJsonStringArray } from './inJsonStringArray';

const render = (values: string[]) =>
  new PgDialect().sqlToQuery(inJsonStringArray(messages.id, values));

describe('inJsonStringArray', () => {
  it('binds the whole set as one JSONB parameter', () => {
    const query = render(['msg_a', 'msg_b']);

    expect(query.params).toEqual(['["msg_a","msg_b"]']);
  });

  it('folds the set into an array so candidates drive an index lookup', () => {
    // `IN (SELECT … jsonb_array_elements_text …)` let the planner, which costs
    // any set-returning function at 100 rows, scan the user's whole history.
    const { sql } = render(['msg_a']);

    expect(sql).toMatch(/"id" = ANY\(ARRAY\(\s*SELECT value/);
    expect(sql).not.toMatch(/"id" IN \(/);
  });

  it('matches nothing for an empty set', () => {
    expect(render([]).sql).toBe('false');
  });
});
