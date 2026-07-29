// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Null-testing a jsonb arrow / path expression inside a WHERE clause crashes the
 * engine backing production — `rt_fetch used out-of-bounds`, SQLSTATE XX000 —
 * before a single row is read.
 *
 * Stock Postgres runs these predicates perfectly happily, so no test against a
 * real database will ever catch one: `getDueScheduledTopics` shipped with full
 * green model tests and its cron then crashed on every tick in production for
 * days. A source-shape guard is the only thing that can hold the line, which is
 * why this asserts on the text of the query rather than on its behavior.
 *
 * The fix is always the same — COALESCE the extracted value to a sentinel:
 *
 *   (metadata ->> 'x') IS NULL              → COALESCE(metadata ->> 'x', '') = ''
 *   (metadata ->> 'x') IS NOT NULL          → COALESCE(metadata ->> 'x', '') <> ''
 *   (metadata ->> 'x') IS DISTINCT FROM 'y' → COALESCE(metadata ->> 'x', '') <> 'y'
 *
 * Prior casualties: `getLatestSpineMessageId` (LOBE-11376, #16693),
 * `getDueScheduledTopics` (#17077).
 */
const FORBIDDEN = /(?:->>?|#>>?)[^\n]*?\b(?:IS\s+(?:NOT\s+)?NULL|IS\s+DISTINCT\s+FROM)\b/i;

const MODELS_DIR = path.join(import.meta.dirname, '..');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const entryPath = path.join(dir, entry);
    if (statSync(entryPath).isDirectory())
      return entry === '__tests__' ? [] : sourceFiles(entryPath);
    return entryPath.endsWith('.ts') ? [entryPath] : [];
  });

describe('jsonb null tests in WHERE clauses', () => {
  it('are absent from every model — they take the production engine down', () => {
    const offenders = sourceFiles(MODELS_DIR).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ file, line: line.trim(), lineNo: index + 1 }))
        // Comments are where we explain the rule, so they get to name the shape.
        .filter(
          ({ line }) => FORBIDDEN.test(line) && !line.startsWith('*') && !line.startsWith('//'),
        )
        .map(({ file, line, lineNo }) => `${file.split('/models/')[1]}:${lineNo}  ${line}`),
    );

    expect(offenders).toEqual([]);
  });
});
