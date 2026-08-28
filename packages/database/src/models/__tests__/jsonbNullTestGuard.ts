import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Source scanner behind the `jsonbNullTest` guards. Lives here rather than
 * inside the test file because the cloud repo runs the same guard over its own
 * query surfaces and must not drift from this one — the whole reason the shape
 * reached `connector.ts` is that only one repo had a guard at all.
 *
 * See `jsonbNullTest.test.ts` for what is being forbidden and why.
 */

/**
 * An extracted jsonb value (arrow `->` / `->>`, path `#>` / `#>>`) whose very
 * next act is a null test. Everything the operand may legally pick up in
 * between — closing parens, `::casts` — is consumed explicitly, so the match
 * stays anchored to *that* expression.
 *
 * The tight adjacency is the point. A loose `->>[^\n]*?IS NULL` also matches
 * templates where the arrow sits in the SELECT list and an unrelated *bare
 * column* is null-tested in the WHERE (`topicUsage.ts` does exactly this, and
 * is safe: a NullTest over a plain column never crashes). Guards that cry wolf
 * get suppressed, and a suppressed guard is worth nothing.
 *
 * `IS DISTINCT FROM` measured safe on pg_search 0.15.26 — it is banned anyway.
 * It is one planner-hook change away from the crashing family, the COALESCE
 * form costs nothing, and no call site uses it today.
 */
const FORBIDDEN =
  /(?:->>?|#>>?)\s*(?:'[^']*'|"[^"]*"|\$\{[^{}]*\}|\w+)(?:\s*(?:\)|::\s*\w+(?:\s*\[\s*\])?))*\s*IS\s+(?:NOT\s+NULL|NULL|DISTINCT\s+FROM)\b/i;

/**
 * Escape hatch for the shapes that are textually identical but provably safe —
 * a null test in a SELECT list, an `ORDER BY`, or an `UPDATE … SET` target, none
 * of which are quals. Requires a reason so the next reader can re-check it:
 *
 *   // jsonb-null-test-safe: SET target list, not a qual — never planned as a filter
 *
 * The reason must be on the marker's own line: `\s*` would happily run past the
 * newline and match the first word of the code below, suppressing on a bare
 * marker.
 */
const SUPPRESSION = /jsonb-null-test-safe:[^\S\n]*\S/;

/** How many lines above a template a suppression comment may sit. */
const SUPPRESSION_REACH = 3;

const sourceFiles = (dir: string): string[] => {
  let found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = path.join(dir, entry);
    if (statSync(entryPath).isDirectory()) {
      if (entry !== '__tests__') found = found.concat(sourceFiles(entryPath));
    } else if (entryPath.endsWith('.ts') && !entryPath.endsWith('.test.ts')) {
      found.push(entryPath);
    }
  }
  return found;
};

/**
 * `const mountedBy = sql`…`` — the fragments a later template splices in with
 * `${mountedBy}`. Collecting these is what makes the guard see `connector.ts`'s
 * original shape, where the arrow lived on line 76 and the null test on 78/86:
 * neither line was forbidden on its own, which is precisely how it shipped.
 */
const fragmentAliases = (source: string): Map<string, string> => {
  const aliases = new Map<string, string>();
  for (const match of source.matchAll(
    /(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*sql\s*(?:<[^>]*>\s*)?`([^`]*)`/g,
  )) {
    aliases.set(match[1], match[2]);
  }
  return aliases;
};

/**
 * Splice fragment aliases into a template. Two passes so a fragment built from
 * another fragment still resolves; deeper nesting is not worth chasing, and the
 * guard stays conservative by leaving anything unresolved as-is.
 */
const expand = (template: string, aliases: Map<string, string>): string => {
  let out = template;
  for (let pass = 0; pass < 2; pass += 1) {
    out = out.replaceAll(/\$\{(\w+)\}/g, (whole, name: string) => aliases.get(name) ?? whole);
  }
  return out;
};

/**
 * The scan, over one file's text. Exported so the guard's own behavior — which
 * is the thing that failed when `connector.ts` slipped through — can be tested
 * against fixtures instead of only against the tree it happens to be scanning.
 */
export const findJsonbNullTestsInSource = (source: string): { line: number; sql: string }[] => {
  const lines = source.split('\n');
  const aliases = fragmentAliases(source);
  const offenders: { line: number; sql: string }[] = [];

  // Whole `sql`…`` templates, newlines and all — a per-line scan cannot see a
  // predicate that wraps, and formatting alone should never decide whether a
  // production-crashing shape is caught.
  for (const match of source.matchAll(/sql\s*(?:<[^>]*>\s*)?`([^`]*)`/g)) {
    const flattened = expand(match[1], aliases).replaceAll(/\s+/g, ' ').trim();
    if (!FORBIDDEN.test(flattened)) continue;

    const line = source.slice(0, match.index).split('\n').length;
    const suppressionWindow = lines
      .slice(Math.max(0, line - 1 - SUPPRESSION_REACH), line)
      .join('\n');
    if (SUPPRESSION.test(suppressionWindow)) continue;

    offenders.push({ line, sql: flattened });
  }

  return offenders;
};

const scanFile = (file: string, relativeTo: string): string[] =>
  findJsonbNullTestsInSource(readFileSync(file, 'utf8')).map(
    ({ line, sql }) => `${path.relative(relativeTo, file)}:${line}  ${sql}`,
  );

/**
 * Returns one `path:line  sql` entry per forbidden predicate found under `dirs`.
 * Paths are reported relative to `relativeTo` so failures read as source
 * locations rather than absolute machine paths.
 */
export const findJsonbNullTests = (dirs: string[], relativeTo: string): string[] =>
  dirs.flatMap((dir) => sourceFiles(dir)).flatMap((file) => scanFile(file, relativeTo));
