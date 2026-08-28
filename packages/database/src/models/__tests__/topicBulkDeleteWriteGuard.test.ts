import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Structural guard against bulk deletes bypassing visitor-run interruption.
 *
 * A share conversation belongs to the VISITOR (`topics.userId` = visitor,
 * `topics.shareId` marking where it came from — see `schemas/topic.ts`), which
 * means it sits in the visitor's OWN topic and message lists. Two different
 * deletes can therefore remove it out from under a live run:
 *
 * 1. The visitor's own user-scoped delete (`topic.removeTopic` /
 *    `removeAllTopics`, `message.removeMessage(s)`) — the row is theirs, so
 *    every ownership predicate matches it.
 * 2. A delete against a table the topic cascades off: `topics.agentId` /
 *    `topics.groupId` / `topics.sessionId` all reference CREATOR-owned rows
 *    (see `schemas/topic.ts`), so the creator can destroy the visitor's topic
 *    without ever naming it.
 *
 * Either way the delete must first snapshot the in-flight `runningOperation`
 * and hand it to `AiAgentService.interruptTask`; otherwise the operation
 * survives with a dangling topic, `shareChat.interruptTask` can no longer
 * authorize a stop, and the run keeps spending the creator's budget.
 *
 * That is why `agents`, `chatGroups` and `sessions` are scanned alongside
 * `topics` and `messages`. `AgentGroupRepository.removeAgentsFromGroup`'s raw
 * `trx.delete(agents)` on a group's owned virtual members shipped exactly
 * that bug — a published agent's topic (and its `agentShares` row) was
 * cascaded away mid-run with no snapshot or interrupt, so the run kept
 * executing with the creator's credentials until the next per-step
 * authorization check. Scanning `packages/database/src` recursively already
 * covers `repositories/**`, not just `models/**` — that repository file is
 * where this pattern was first missed.
 *
 * This test does not verify the snapshot-and-interrupt contract is followed
 * CORRECTLY inside an allowed file (the model-level tests, e.g.
 * `topic.test.ts` / `session.test.ts` / `chatGroup.test.ts` /
 * `repositories/agentGroup/index.test.ts`, do that) — it only makes sure a
 * FUTURE raw `.delete(topics)` / `.delete(messages)` / `.delete(agents)` /
 * `.delete(chatGroups)` / `.delete(sessions)` write cannot land silently: a
 * new file matching the pattern fails this test until a human either wires
 * the same `onShareRunsInterrupted` contract or documents in `ALLOWED_FILES`
 * below why this particular delete cannot reach a share-visitor row.
 */
const ALLOWED_FILES = new Set([
  // TopicModel: every raw `topics` delete goes through
  // `deleteWithShareRunSnapshot`, which snapshots the in-flight share runs
  // matching that delete's own predicate before it runs. See
  // `TopicModelOptions.onShareRunsInterrupted`'s JSDoc.
  'models/topic.ts',
  // AgentCopyJobModel.deleteEmptyTargetTopic: deletes only a copy-TARGET
  // shell that the drain has not written to yet (`hasNo(messages)` guards
  // every table a real conversation would have populated). A target shell is
  // created fresh by the copy job itself and never carries a `runningOperation`
  // marker of its own — that marker lives on the SOURCE topic the drain reads
  // from, which this delete never touches — so there is no in-flight run this
  // delete could silently orphan.
  'models/agentCopyJob.ts',
  // MessageModel: message-level deletes never touch the `topics` row, so
  // `TopicModel`'s snapshot never fires for them — each carries its own via
  // `snapshotActiveShareRunsForTopics` /
  // `deleteMessagesWithShareRunSnapshot`. See
  // `MessageModelOptions.onShareRunsInterrupted`'s JSDoc.
  'models/message.ts',
  // AgentModel: `delete()` and `batchDelete()` both raw-delete `agents`
  // (`batchDelete()` snapshots per agent id, matching `delete()`'s single-id
  // snapshot) and `delete()` also raw-deletes the agent's `sessions` after
  // snapshotting. See `AgentModelOptions.onShareRunsInterrupted`'s JSDoc.
  'models/agent.ts',
  // ChatGroupModel: `delete()` / `deleteAll()` raw-delete `chatGroups` AND
  // their owned virtual members' `agents` rows, both snapshotted via
  // `snapshotOwnedMemberShareRuns` before the delete. See
  // `ChatGroupModelOptions.onShareRunsInterrupted`'s JSDoc.
  'models/chatGroup.ts',
  // SessionModel: `delete()` / `batchDelete()` / `deleteAll()` raw-delete
  // `sessions` and their orphaned `agents`, all snapshotted via
  // `clearOrphanAgent` / the `deleteAll()` sweep before the delete. See
  // `SessionModelOptions.onShareRunsInterrupted`'s JSDoc.
  'models/session.ts',
  // AgentGroupRepository: `removeAgentsFromGroup` raw-deletes a group's OWNED
  // virtual members' `agents` rows, snapshotted via
  // `snapshotOwnedMemberShareRuns` before the delete — the fix for the bug
  // this guard's scope was extended to catch. See
  // `AgentGroupRepositoryOptions.onShareRunsInterrupted`'s JSDoc.
  'repositories/agentGroup/index.ts',
]);

const SRC_ROOT = path.join(__dirname, '../../');

const RAW_WRITE_PATTERN =
  /\.delete\(topics\)|\.delete\(messages\)|\.delete\(agents\)|\.delete\(chatGroups\)|\.delete\(sessions\)/;

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
