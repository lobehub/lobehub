import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Structural guard against visitor-content leaks in aggregate reads.
 *
 * Share-visitor topics carry the creator's `userId` (billing/data attribution)
 * plus a non-null `senderId` (the visitor) — see `utils/shareVisitor.ts`. A
 * query that aggregates `topics`/`messages` rows across many conversations for
 * one creator (a `.groupBy(...)` scan, as opposed to a single already-
 * authorized topic/message lookup) is exactly the shape that silently
 * surfaces visitor content unless it explicitly ANDs in
 * `notShareVisitorTopic()` / `notShareVisitorMessage()`.
 *
 * This exact bug has resurfaced across independent readers in this PR's
 * review rounds — `TopicSummaryModel.listCandidates`,
 * `AgentSignalReviewContextModel.listToolActivity` /
 * `listTopicActivity` / `listSelfReflectionTopicActivity`, and
 * `ExpertiseIngestionService`'s historical backfill scan — each fixed only
 * after a reviewer named that specific file, while a sibling batch reader
 * kept the leak alive one round longer. This test does not verify the
 * exclusion is applied to the RIGHT clause (the model-level tests above do
 * that) — it only makes sure a FUTURE creator-scoped batch aggregation over
 * `topics`/`messages` cannot land silently: a new file matching the pattern
 * fails this test until a human either adds the exclusion call or documents
 * in `ALLOWED_FILES` below why this particular aggregation is not creator
 * background processing (e.g. it is scoped to one already-authorized topic,
 * or the resource is unreachable from a share-visitor flow).
 */
// Keys are `${rootLabel}:${relativePath}`, matching the `rootLabel` used below.
const ALLOWED_FILES = new Set([
  // heteroSessionImporter: aggregates message counts for topics the CALLING
  // user imported from their own CLI/device session (matched by clientId
  // prefix). Share-visitor topics are never CLI-imported, so this can't
  // observe visitor rows.
  'database:repositories/heteroSessionImporter/index.ts',
  // topicComment: the `messages.userId` groupBy is scoped to one explicit,
  // already-authorized `topicId` passed by the caller (not a creator-wide
  // scan), and comments require a workspace-scoped topic — share-visitor
  // topics are personal-scope (`workspaceId IS NULL`) and unreachable here.
  'database:models/topicComment.ts',
]);

// Two independent trees define drizzle queries: the shared database package,
// and server-side services that query `@lobechat/database/schemas` directly
// (e.g. `ExpertiseIngestionService`'s historical backfill).
const SCAN_ROOTS: { label: string; root: string }[] = [
  { label: 'database', root: path.join(__dirname, '../../') },
  { label: 'server', root: path.join(__dirname, '../../../../../apps/server/src') },
];

const GROUP_BY_PATTERN = /\.groupBy\(/;
const FROM_TOPICS_OR_MESSAGES_PATTERN = /\.from\(topics\)|\.from\(messages\)/;
const EXCLUSION_PATTERN = /notShareVisitorTopic|notShareVisitorMessage/;

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

describe('share-visitor batch read guard', () => {
  it('every creator-scoped topics/messages aggregation excludes share-visitor rows', () => {
    const offenders: string[] = [];

    for (const { label, root } of SCAN_ROOTS) {
      for (const file of listTsFiles(root)) {
        const relativePath = path.relative(root, file).split(path.sep).join('/');
        const key = `${label}:${relativePath}`;
        if (ALLOWED_FILES.has(key)) continue;
        if (relativePath === 'utils/shareVisitor.ts') continue;

        const content = readFileSync(file, 'utf8');
        if (!GROUP_BY_PATTERN.test(content)) continue;
        if (!FROM_TOPICS_OR_MESSAGES_PATTERN.test(content)) continue;
        if (EXCLUSION_PATTERN.test(content)) continue;

        offenders.push(key);
      }
    }

    expect(offenders).toEqual([]);
  });
});
