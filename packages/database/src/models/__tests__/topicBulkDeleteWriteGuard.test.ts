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
 * `agents`, `chatGroups` and `sessions` are covered by the SAME pattern for
 * the SAME reason: `topics.agentId` / `topics.groupId` / `topics.sessionId`
 * all cascade off those tables (see `schemas/topic.ts`), so a raw bulk delete
 * against any of them removes a visitor's topic just as directly as deleting
 * `topics` itself. `AgentGroupRepository.removeAgentsFromGroup`'s raw
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
