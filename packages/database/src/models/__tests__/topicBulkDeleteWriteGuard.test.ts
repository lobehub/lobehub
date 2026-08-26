import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Structural guard for LOBE-11930.
 *
 * A share-visitor topic is owned by the creator (`topics.userId` = creator,
 * `topics.senderId` = visitor — see `utils/shareVisitor.ts`), so ANY raw bulk
 * delete against the `topics` (or `messages`) table that matches on the
 * creator's own scope (`userId` / `workspaceId`) — as opposed to a single
 * already-authorized row — matches a visitor's row too, unless it first
 * snapshots the visitor's in-flight `runningOperation` and hands it to
 * `AiAgentService.interruptTask`. `TopicModel.deleteAll()` (the checked
 * `topic.removeAllTopics` router path) shipped exactly that bug: a visitor's
 * running topic was deleted with no interrupt, the operation row survived
 * with `topicId` set to null, and the visitor's `shareChat.interruptTask`
 * could no longer find the topic to authorize the stop — see
 * `TopicModelOptions.onShareRunsInterrupted`'s JSDoc for the fix.
 *
 * This test does not verify the snapshot-and-interrupt contract is followed
 * CORRECTLY inside an allowed file (the model-level tests, e.g.
 * `topic.test.ts` / `session.test.ts`, do that) — it only makes sure a
 * FUTURE raw `.delete(topics)` / `.delete(messages)` write cannot land
 * silently: a new file matching the pattern fails this test until a human
 * either wires the same `onShareRunsInterrupted` contract or documents in
 * `ALLOWED_FILES` below why this particular delete cannot reach a
 * share-visitor row.
 */
const ALLOWED_FILES = new Set([
  // TopicModel: the contract's own home for `topics`
  // (`delete`/`batchDelete`/`batchDeleteByAgentId`/`batchDeleteByGroupId`/
  // `batchDeleteBySessionId`/`deleteAll` all snapshot via
  // `findActiveVisitorRunTopics(Matching)` and call `onShareRunsInterrupted`
  // after commit).
  'models/topic.ts',
  // AgentCopyJobModel.deleteEmptyTargetTopic: deletes only a copy-TARGET
  // shell that the drain has not written to yet (`hasNo(messages)` guards
  // every table a real conversation would have populated). A target shell is
  // created fresh by the copy job itself and never carries a `runningOperation`
  // marker of its own — that marker lives on the SOURCE topic the drain reads
  // from, which this delete never touches — so there is no in-flight run this
  // delete could silently orphan.
  'models/agentCopyJob.ts',
  // MessageModel: the contract's own home for `messages`
  // (`deleteMessage`/`deleteMessages`/`deleteMessagesBySession`/
  // `deleteAllMessages`/`batchDeleteByAgentId` all snapshot in-flight
  // visitor runs via `TopicModel.findActiveVisitorRunTopicsByIds` and call
  // `onShareRunsInterrupted` after commit — see `MessageModelOptions
  // .onShareRunsInterrupted`'s JSDoc). File-level allowlisting (rather than a
  // per-method check) mirrors `models/topic.ts` above: this guard's scope is
  // "did a NEW raw delete bypass the contract", not "is every raw delete in
  // an audited file individually re-verified here" — the model-level tests
  // (`messages/message.delete.test.ts`) cover per-method correctness.
  'models/message.ts',
]);

const SRC_ROOT = path.join(__dirname, '../../');

const RAW_WRITE_PATTERN = /\.delete\(topics\)|\.delete\(messages\)/;

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

describe('topics/messages raw bulk-delete write guard', () => {
  it('every raw topics/messages delete lives in an audited file', () => {
    const offenders: string[] = [];

    for (const file of listTsFiles(SRC_ROOT)) {
      const relativePath = path.relative(SRC_ROOT, file).split(path.sep).join('/');
      if (ALLOWED_FILES.has(relativePath)) continue;

      const content = readFileSync(file, 'utf8');
      if (RAW_WRITE_PATTERN.test(content)) offenders.push(relativePath);
    }

    expect(offenders).toEqual([]);
  });
});
