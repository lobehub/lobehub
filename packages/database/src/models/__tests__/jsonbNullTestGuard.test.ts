// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { findJsonbNullTestsInSource } from './jsonbNullTestGuard';

const sqlOf = (source: string) => findJsonbNullTestsInSource(source).map((o) => o.sql);

/**
 * The guard's own regression suite. `connector.ts` shipped the forbidden shape
 * past a guard that was already watching the directory it lived in — the shape
 * was simply split across three lines through an interpolated fragment, and the
 * guard matched line by line. These lock in that it now sees through both, and
 * — just as importantly — that it stays quiet on the safe shapes, because a
 * guard that cries wolf gets deleted.
 */
describe('findJsonbNullTestsInSource', () => {
  describe('catches', () => {
    it('a null test written inline', () => {
      expect(sqlOf("const p = sql`${topics.metadata} ->> 'cronJobId' IS NULL`")).toHaveLength(1);
    });

    it('the connector.ts shape: arrow in a fragment, null test at the use site', () => {
      // The exact regression. Neither line is forbidden on its own.
      const source = `
        const mountedBy = sql\`\${userConnectors.metadata} ->> 'mountedByAgentId'\`;
        const predicate = sql\`\${mountedBy} IS NULL\`;
      `;
      expect(sqlOf(source)).toEqual(["${userConnectors.metadata} ->> 'mountedByAgentId' IS NULL"]);
    });

    it('a fragment spliced into an OR alongside a safe comparison', () => {
      const source = `
        const mountedBy = sql\`\${userConnectors.metadata} ->> 'mountedByAgentId'\`;
        or(sql\`\${mountedBy} = \${agentId}\`, sql\`\${mountedBy} IS NULL\`);
      `;
      expect(sqlOf(source)).toHaveLength(1);
    });

    it('a predicate that wraps across lines', () => {
      const source = [
        'const p = sql`',
        '  ${topics.metadata}',
        "    #>> '{scheduledRun,claim,expiresAt}'",
        '    IS NOT NULL',
        '`;',
      ].join('\n');
      expect(sqlOf(source)).toHaveLength(1);
    });

    it('a null test reached through a cast and a closing paren', () => {
      const source =
        "const p = sql`WHERE ((${t.metadata}) -> 'progress' ->> 'total')::int IS NOT NULL`";
      expect(sqlOf(source)).toHaveLength(1);
    });

    it('IS DISTINCT FROM, banned as a precaution', () => {
      expect(
        sqlOf("const p = sql`${topics.metadata} ->> 'status' IS DISTINCT FROM 'done'`"),
      ).toHaveLength(1);
    });

    it('a fragment built from another fragment', () => {
      const source = `
        const raw = sql\`\${t.metadata} ->> 'k'\`;
        const cast = sql\`(\${raw})::int\`;
        const p = sql\`\${cast} IS NULL\`;
      `;
      expect(sqlOf(source)).toHaveLength(1);
    });
  });

  describe('stays quiet on', () => {
    it('the COALESCE rewrite that replaces it', () => {
      expect(sqlOf("const p = sql`COALESCE(${t.metadata} ->> 'copied', '') <> 'true'`")).toEqual(
        [],
      );
    });

    it('a bare-column null test sharing a template with an arrow in the SELECT list', () => {
      // `topicUsage.ts` — safe: a null test over a plain column never crashes.
      const source =
        'const p = sql`SELECT usage->\'tools\' AS "toolsUsage" FROM agent_operations WHERE topic_id = ${id} AND (usage IS NOT NULL OR cost IS NOT NULL)`';
      expect(sqlOf(source)).toEqual([]);
    });

    it('an arrow whose value is compared rather than null-tested', () => {
      expect(sqlOf("const p = sql`${t.metadata} ->> 'mountedByAgentId' = ${agentId}`")).toEqual([]);
    });

    it('key-existence operators', () => {
      expect(sqlOf("const p = sql`${t.metadata} ? 'cronJobId'`")).toEqual([]);
      expect(
        sqlOf("const p = sql`NOT COALESCE(jsonb_exists(${t.metadata}, 'signal'), false)`"),
      ).toEqual([]);
    });

    it('an aggregate that casts an arrow result and aliases it', () => {
      const source =
        "const p = sql`sum((COALESCE(usage, metadata->'usage')->>'cost')::numeric) AS \"cost\" FROM messages WHERE usage IS NOT NULL`";
      expect(sqlOf(source)).toEqual([]);
    });
  });

  describe('suppression', () => {
    const offending = "        status: sql`WHEN ${t.metadata} ->> 'total' IS NOT NULL THEN 1 END`";

    it('honors a reasoned jsonb-null-test-safe comment above the template', () => {
      const source = [
        '        // jsonb-null-test-safe: SET target list, not a qual',
        offending,
      ].join('\n');
      expect(sqlOf(source)).toEqual([]);
    });

    it('ignores the marker when no reason follows it', () => {
      const source = ['        // jsonb-null-test-safe:', offending].join('\n');
      expect(sqlOf(source)).toHaveLength(1);
    });

    it('does not let a marker suppress a template further down the file', () => {
      const source = [
        '        // jsonb-null-test-safe: applies to the next one only',
        '        const ok = sql`1 = 1`;',
        '',
        '',
        '',
        offending,
      ].join('\n');
      expect(sqlOf(source)).toHaveLength(1);
    });
  });

  it('reports the line the offending template starts on', () => {
    const source = ['// a', '// b', "const p = sql`${t.metadata} ->> 'k' IS NULL`"].join('\n');
    expect(findJsonbNullTestsInSource(source)[0].line).toBe(3);
  });
});
