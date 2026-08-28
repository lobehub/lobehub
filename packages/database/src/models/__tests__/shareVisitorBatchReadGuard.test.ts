import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Structural guard against visitor-content leaks in aggregate reads.
 *
 * A share-visitor topic belongs to the VISITOR (`topics.userId` is the
 * visitor, `topics.shareId` is its only provenance marker — see
 * `../schemas/topic.ts` and `../utils/shareProvenance.ts`). That means a
 * caller-scoped read — one whose `WHERE`/join conditions pin `topics.userId`
 * or `messages.userId` to a single caller (directly via `eq(...)`, or through
 * `buildWorkspaceWhere`, which reduces to the same `eq(cols.userId, ctx.userId)`
 * in personal mode) — cannot reach a visitor's row at all: it belongs to a
 * different user. Isolation holds by construction, not by an exclusion filter.
 *
 * The one shape that is NOT safe by construction is a SYSTEM-scoped scan: a
 * `.groupBy(...)` aggregation over `topics`/`messages` with no per-caller
 * `userId` pin, run across every user's rows (e.g. a background job). That
 * shape must explicitly exclude share provenance via `notShareTopic()`
 * (`../utils/shareProvenance.ts`) or it will silently act on — and bill —
 * a visitor's conversation on behalf of a job the shared agent's creator is
 * supposed to be funding. `TopicSummaryModel.listCandidates` is the one
 * caller today.
 *
 * The check is PER QUERY, not per file. Judging per file would make this
 * guard useless in exactly the places it matters most: `models/topic.ts` and
 * `models/message.ts` are full of correctly-pinned queries, so a single
 * `eq(topics.userId, …)` anywhere in either file would vouch for every future
 * unpinned `groupBy` added next to it. Each `.from(topics)` / `.from(messages)`
 * chain is therefore sliced out and judged on its own clauses.
 *
 * This test does not verify the pin or the exclusion is wired into the RIGHT
 * clause of a given query (the model-level tests do that) — it only makes sure
 * a FUTURE aggregation cannot land silently with neither: a new one fails this
 * test until a human either adds one, or documents in `ALLOWED_FILES` below
 * why this particular aggregation needs neither (e.g. it is scoped to one
 * already-authorized topic, or the resource is unreachable from a share flow).
 */
// Keys are `${rootLabel}:${relativePath}`, matching the `rootLabel` used below.
const ALLOWED_FILES = new Set([
  // topicComment: the `messages.userId` groupBy is scoped to one explicit,
  // already-authorized `topicId` passed by the caller (not a per-user
  // ownership pin, so the structural check below can't see it) — not a
  // creator-wide scan. Comments also require a workspace-scoped topic, and
  // share-visitor topics are personal-scope (`workspaceId IS NULL`), so this
  // is unreachable from a share-visitor flow regardless.
  'database:models/topicComment.ts',
  // expertise/ingestion.ts `listHistoricalTopics`: pinned, but through a local
  // `scope` const (`eq(messages.userId, this.userId)` in personal mode,
  // `eq(messages.workspaceId, …)` in workspace mode) built a few lines above
  // the query — the per-query slice below cannot see through a local
  // variable. Verified by hand; re-verify if that helper's definition moves.
  'server:services/expertise/ingestion.ts',
]);

// Two independent trees define drizzle queries: the shared database package,
// and server-side services that query `@lobechat/database/schemas` directly
// (e.g. the expertise ingestion history backfill).
const SCAN_ROOTS: { label: string; root: string }[] = [
  { label: 'database', root: path.join(__dirname, '../../') },
  { label: 'server', root: path.join(__dirname, '../../../../../apps/server/src') },
];

const GROUP_BY_PATTERN = /\.groupBy\(/;
const FROM_TOPICS_OR_MESSAGES_PATTERN = /\.from\((?:topics|messages)\)/g;
// A per-caller ownership pin on `topics.userId` / `messages.userId`, in any of
// the shapes this codebase writes it: a direct `eq(...)` / `inArray(...)`,
// `buildWorkspaceWhere` itself (which reduces to that same equality in
// personal, non-workspace mode), or one of the thin per-class wrappers around
// it — `ownership()` / `messageOwnership()` / `ws()` / `scopeWhere()`, plus
// `analyticsConditions()`, whose first entry is `this.ownership()`.
//
// Recognising the wrappers by NAME is the deliberate trade-off of judging
// queries in isolation: the slice cannot see through a helper call, and
// treating every wrapped query as unpinned would bury the guard in noise. Any
// NEW wrapper name has to be added here consciously, which is the review step
// this guard exists to force.
const OWNERSHIP_PIN_PATTERN =
  /(?:eq|inArray)\((?:topics|messages)\.userId,|buildWorkspaceWhere\(|this\.(?:ownership|messageOwnership|ws|scopeWhere|analyticsConditions)\(/;
// The explicit exclusion required for the one shape that has no per-caller
// pin: a system-wide scan across every user's rows.
const SHARE_EXCLUSION_PATTERN = /notShareTopic\(/;

const listTsFiles = (dir: string): string[] => {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '__tests__') continue;

    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...listTsFiles(fullPath));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }

  return files;
};

/**
 * Slice out each drizzle chain that reads `topics` / `messages`, so every
 * aggregation is judged on its OWN clauses rather than on whatever a sibling
 * query in the same file happens to do.
 *
 * A chain's clauses (`.where(...)`, `.groupBy(...)`) all follow its
 * `.from(...)`, so the slice starts there and ends at whichever comes first:
 * the next `.from(topics|messages)` in the file, or the `;` that terminates
 * the statement. Deliberately a text heuristic, not a parse — an over-wide
 * slice can only ever hide an offender by attributing a neighbour's pin to it,
 * which is still strictly narrower than the whole-file check it replaces, and
 * an over-narrow one surfaces as a failure a human then reads.
 */
const sliceTableReadChains = (content: string): string[] => {
  const starts = [...content.matchAll(FROM_TOPICS_OR_MESSAGES_PATTERN)].map((m) => m.index!);

  return starts.map((start, index) => {
    const nextStart = starts[index + 1] ?? content.length;
    const statementEnd = content.indexOf(';', start);
    const end = statementEnd === -1 ? nextStart : Math.min(statementEnd, nextStart);

    return content.slice(start, end);
  });
};

describe('share-visitor batch read guard', () => {
  it('every topics/messages aggregation is either ownership-pinned or excludes share rows', () => {
    const offenders: string[] = [];

    for (const { label, root } of SCAN_ROOTS) {
      for (const file of listTsFiles(root)) {
        const relativePath = path.relative(root, file).split(path.sep).join('/');
        const key = `${label}:${relativePath}`;
        if (ALLOWED_FILES.has(key)) continue;
        if (relativePath === 'utils/shareProvenance.ts') continue;

        const content = readFileSync(file, 'utf8');
        if (!GROUP_BY_PATTERN.test(content)) continue;

        for (const chain of sliceTableReadChains(content)) {
          if (!GROUP_BY_PATTERN.test(chain)) continue;
          if (OWNERSHIP_PIN_PATTERN.test(chain)) continue;
          if (SHARE_EXCLUSION_PATTERN.test(chain)) continue;

          offenders.push(`${key} :: ${chain.split('\n')[0].trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
