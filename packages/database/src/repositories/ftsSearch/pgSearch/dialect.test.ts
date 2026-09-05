import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { agents } from '../../../schemas/agent';
import { pgLikeDialect, pgSearchDialect } from './dialect';

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

describe('pgLikeDialect', () => {
  it('rejects blank queries', () => {
    expect(() => pgLikeDialect.prepare('   ')).toThrow('Query is empty after sanitization');
    expect(pgLikeDialect.prepare('  kube  ')).toBe('kube');
  });

  it('requires every term inside one field and escapes LIKE wildcards', () => {
    const match = render(
      pgLikeDialect.match(
        [{ column: agents.title }, { column: agents.tags, jsonb: true }],
        '100% a_b',
      ),
    );

    expect(match.sql).toBe(
      `(("agents"."title" ILIKE $1 ESCAPE '\\' AND "agents"."title" ILIKE $2 ESCAPE '\\') OR ("agents"."tags"::text ILIKE $3 ESCAPE '\\' AND "agents"."tags"::text ILIKE $4 ESCAPE '\\'))`,
    );
    expect(match.params).toEqual(['%100\\%%', '%a\\_b%', '%100\\%%', '%a\\_b%']);
  });

  it('bounds the number of expanded terms so bind parameters stay under the PostgreSQL limit', () => {
    const fields = [agents.id, agents.title, agents.description, agents.slug, agents.tags].map(
      (column) => ({ column }),
    );
    const query = Array.from({ length: 5000 }, (_, index) => `term${index}`).join(' ');

    const match = render(pgLikeDialect.match(fields, query));
    expect(match.params).toHaveLength(fields.length * 48);
    expect(match.params[0]).toBe('%term0%');
    expect(match.params[47]).toBe('%term47%');

    const score = render(pgLikeDialect.score(agents.id, fields, query));
    expect(score.params).toHaveLength(fields.length * (48 + 3));
  });

  it('weights exact, prefix, phrase, and all-terms matches per field', () => {
    const score = render(
      pgLikeDialect.score(agents.id, [{ column: agents.title, weight: 5 }], 'kube ops'),
    );

    expect(score.sql).toContain('WHEN "agents"."title" ILIKE $1');
    expect(score.sql).toContain('THEN 20');
    expect(score.sql).toContain('THEN 15');
    expect(score.sql).toContain('THEN 10');
    expect(score.sql).toContain('THEN 5');
    expect(score.sql).toContain('ELSE 0');
    expect(score.params[0]).toBe('kube ops');
    expect(score.params).toContain('kube ops%');
    expect(score.params).toContain('%kube ops%');
  });
});
