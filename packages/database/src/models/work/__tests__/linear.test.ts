// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { topics, works, workVersions } from '../../../schemas';
import { WorkModel } from '..';
import { normalizeLinearToolResult } from '../linearToolResult';
import {
  cleanupWorkTestData,
  expectExternalSummaryItem,
  seedWorkTestData,
  serverDB,
  topicId,
  userId,
  userId2,
} from './_fixtures';

beforeEach(seedWorkTestData);
afterEach(cleanupWorkTestData);

/** Re-query the immutable snapshot selected by works.currentVersionId. */
const currentVersionRow = async (workId: string) => {
  const [row] = await serverDB
    .select({ version: workVersions })
    .from(works)
    .innerJoin(workVersions, eq(works.currentVersionId, workVersions.id))
    .where(eq(works.id, workId));
  return row.version;
};

describe('WorkModel · linear', () => {
  it('keeps merged display columns when a version-create retry follows a concurrent write', async () => {
    const workModel = new WorkModel(serverDB, userId);
    const baseParams = {
      resourceId: 'issue-race',
      resourceType: 'linear_issue' as const,
      toolIdentifier: 'linear',
      toolName: 'save_issue',
      topicId,
    };

    const first = await workModel.registerExternal({
      ...baseParams,
      description: 'Original description',
      patchFields: ['title', 'status', 'description'],
      changeType: 'created',
      rootOperationId: 'op-race-create',
      toolCallId: 'tool-call-race-create',
      status: 'Backlog',
      title: 'Original title',
    });
    expect(first).toBeDefined();

    // Simulate losing the version-number race: the first insert attempt fails
    // with a unique violation while a concurrent registration commits a
    // version that renames the issue.
    const originalTransaction = serverDB.transaction.bind(serverDB);
    let raced = false;
    // Drizzle's transaction signature gained an optional config param upstream;
    // the spy only exercises the callback path, so widen via cast.
    const transactionSpy = vi.spyOn(serverDB, 'transaction').mockImplementation((async (
      callback: never,
    ) => {
      if (raced) return originalTransaction(callback);
      raced = true;

      await workModel.registerExternal({
        ...baseParams,
        patchFields: ['title'],
        changeType: 'updated',
        rootOperationId: 'op-race-winner',
        toolCallId: 'tool-call-race-winner',
        title: 'Winner title',
      });

      throw new Error(
        'duplicate key value violates unique constraint "work_versions_work_id_version_unique"',
      );
    }) as never);

    try {
      await workModel.registerExternal({
        ...baseParams,
        patchFields: ['status'],
        changeType: 'updated',
        rootOperationId: 'op-race-loser',
        toolCallId: 'tool-call-race-loser',
        status: 'In Progress',
      });
    } finally {
      transactionSpy.mockRestore();
    }

    const versions = await workModel.listVersions(first!.id);
    expect(versions.map((item) => item.version)).toEqual([3, 2, 1]);

    // Without re-reading inside the retry, the status-only patch would copy a
    // stale snapshot and revert the winner's title. The latest immutable version
    // must combine both concurrent changes with the original description.
    const current = await currentVersionRow(first!.id);
    expect(current).toMatchObject({
      description: 'Original description',
      status: 'In Progress',
      title: 'Winner title',
    });
  });

  it('registers Linear issue creates and appends versions for edits', async () => {
    const workModel = new WorkModel(serverDB, userId);

    const first = await workModel.handleSkillToolResult({
      provider: 'linear',
      args: { team: 'Engineering', title: 'Linear Work issue' },
      data: {
        description: 'Track Linear issue as Work',
        id: 'issue-uuid-10966',
        identifier: 'LOBE-10966',
        labels: ['claude code'],
        priority: { name: 'High', value: 2 },
        state: { name: 'Backlog' },
        statusType: 'backlog',
        team: 'Engineering',
        teamId: 'team-1',
        title: 'Linear Work issue',
        url: 'https://linear.app/lobehub/issue/LOBE-10966/linear-work-issue',
      },
      rootOperationId: 'op-linear-issue-create',
      toolCallId: 'tool-call-linear-issue-create',
      toolName: 'save_issue',
      topicId,
    });

    const second = await workModel.handleSkillToolResult({
      provider: 'linear',
      args: { id: 'issue-uuid-10966', state: 'In Progress' },
      data: {
        id: 'issue-uuid-10966',
        state: 'In Progress',
        statusType: 'started',
        updatedAt: '2026-07-01T13:23:10.614Z',
      },
      rootOperationId: 'op-linear-issue-edit',
      toolCallId: 'tool-call-linear-issue-edit',
      toolName: 'save_issue',
      topicId,
    });
    const replay = await workModel.handleSkillToolResult({
      provider: 'linear',
      args: { id: 'issue-uuid-10966', state: 'In Progress' },
      data: {
        id: 'issue-uuid-10966',
        state: 'In Progress',
      },
      rootOperationId: 'op-linear-issue-edit',
      toolCallId: 'tool-call-linear-issue-edit',
      toolName: 'save_issue',
      topicId,
    });

    expect(second?.id).toBe(first?.id);
    expect(replay?.id).toBe(first?.id);
    // The Work row keeps stable resource identity plus the current card projection.
    expect(second).toMatchObject({
      description: 'Track Linear issue as Work',
      resourceId: 'issue-uuid-10966',
      resourceType: 'linear_issue',
      toolIdentifier: 'linear',
      title: 'Linear Work issue',
      type: 'external',
    });

    const versions = await workModel.listVersions(first!.id);
    expect(versions.map((item) => item.version)).toEqual([2, 1]);
    expect(versions[0]).toMatchObject({
      changeType: 'updated',
      content: 'Track Linear issue as Work',
      description: 'Track Linear issue as Work',
      identifier: 'LOBE-10966',
      status: 'In Progress',
      title: 'Linear Work issue',
      url: 'https://linear.app/lobehub/issue/LOBE-10966/linear-work-issue',
    });
    expect(versions[1]).toMatchObject({
      status: 'Backlog',
      title: 'Linear Work issue',
    });

    const byOperation = await workModel.listSummariesByRootOperations({
      rootOperationIds: ['op-linear-issue-create', 'op-linear-issue-edit'],
    });
    expect(byOperation['op-linear-issue-create']).toEqual([]);
    const issueSummary = expectExternalSummaryItem(byOperation['op-linear-issue-edit']?.[0]);
    expect(issueSummary).toMatchObject({
      identifier: 'LOBE-10966',
      status: 'In Progress',
      title: 'Linear Work issue',
    });

    const byConversation = await workModel.listByConversation({ topicId });
    expect(byConversation).toHaveLength(1);
    expect(byConversation[0]).toMatchObject({
      identifier: 'LOBE-10966',
      resourceType: 'linear_issue',
      type: 'external',
    });

    await workModel.handleSkillToolResult({
      provider: 'linear',
      data: { id: 'issue-uuid-read', title: 'Read only' },
      toolCallId: 'tool-call-linear-read',
      toolName: 'get_issue',
      topicId,
    });
    await workModel.handleSkillToolResult({
      provider: 'linear',
      data: { error: 'Invalid issue', isError: true },
      toolCallId: 'tool-call-linear-error',
      toolName: 'save_issue',
      topicId,
    });

    const workRows = await serverDB
      .select()
      .from(works)
      .where(eq(works.resourceType, 'linear_issue'));
    expect(workRows).toHaveLength(1);
  });

  it('registers Linear documents and keeps merged display columns across partial updates', async () => {
    const workModel = new WorkModel(serverDB, userId);

    const document = await workModel.handleSkillToolResult({
      provider: 'linear',
      args: { title: 'Linear document', team: 'Engineering' },
      data: JSON.stringify({
        document: {
          content: 'Document body',
          id: 'doc-1',
          slug: 'linear-document',
          title: 'Linear document',
          url: 'https://linear.app/lobehub/document/linear-document',
        },
      }),
      rootOperationId: 'op-linear-document-create',
      toolCallId: 'tool-call-linear-document-create',
      toolName: 'create_document',
      topicId,
    });
    const editedDocument = await workModel.handleSkillToolResult({
      provider: 'linear',
      args: { content: 'Updated body', id: 'doc-1' },
      data: {
        content: 'Updated body',
        id: 'doc-1',
        slugId: '8298fa69b2e3',
        title: 'Linear document updated',
        url: 'https://linear.app/lobehub/document/linear-document-8298fa69b2e3',
      },
      rootOperationId: 'op-linear-document-edit',
      toolCallId: 'tool-call-linear-document-edit',
      toolName: 'save_document',
      topicId,
    });
    const partialDocumentUpdate = await workModel.handleSkillToolResult({
      provider: 'linear',
      args: { content: 'Partial body', id: 'doc-1' },
      data: {
        content: 'Partial body',
        id: 'doc-1',
      },
      rootOperationId: 'op-linear-document-partial-edit',
      toolCallId: 'tool-call-linear-document-partial-edit',
      toolName: 'save_document',
      topicId,
    });

    // Comments are intentionally NOT adapted as Work entities — a comment
    // mutation must neither create its own work nor touch the parent issue.
    const comment = await workModel.handleSkillToolResult({
      provider: 'linear',
      args: { body: 'Looks good', issueId: 'LOBE-10966' },
      data: {
        body: 'Looks good',
        id: 'comment-1',
        url: 'https://linear.app/lobehub/issue/LOBE-10966#comment-1',
      },
      rootOperationId: 'op-linear-comment-create',
      toolCallId: 'tool-call-linear-comment-create',
      toolName: 'save_comment',
      topicId,
    });
    expect(comment).toBeNull();

    expect(document).toMatchObject({
      resourceId: 'doc-1',
      resourceType: 'linear_document',
      type: 'external',
    });
    expect(editedDocument?.id).toBe(document!.id);
    expect(partialDocumentUpdate?.id).toBe(document!.id);

    const documentVersions = await workModel.listVersions(document!.id);
    expect(documentVersions.map((item) => item.version)).toEqual([3, 2, 1]);
    // The content-only update inherits every field it did not carry from v2.
    expect(documentVersions[0]).toMatchObject({
      content: 'Partial body',
      description: 'Partial body',
      identifier: 'linear-document-8298fa69b2e3',
      title: 'Linear document updated',
      url: 'https://linear.app/lobehub/document/linear-document-8298fa69b2e3',
    });

    await workModel.handleSkillToolResult({
      provider: 'linear',
      args: { id: 'comment-1' },
      data: { id: 'comment-1' },
      toolCallId: 'tool-call-linear-comment-delete',
      toolName: 'delete_comment',
      topicId,
    });

    const commentWork = await serverDB
      .select()
      .from(works)
      .where(eq(works.resourceId, 'comment-1'));
    const documentWork = await serverDB.select().from(works).where(eq(works.resourceId, 'doc-1'));
    expect(commentWork).toHaveLength(0);
    expect(documentWork).toHaveLength(1);
  });

  it('keeps Linear works isolated by user for the same external resource', async () => {
    const otherTopicId = 'work-test-other-linear-topic-id';
    await serverDB.insert(topics).values({ id: otherTopicId, userId: userId2 });

    const workModel = new WorkModel(serverDB, userId);
    const otherWorkModel = new WorkModel(serverDB, userId2);

    const ownerWork = await workModel.handleSkillToolResult({
      provider: 'linear',
      args: { team: 'Engineering', title: 'Owner issue title' },
      data: {
        id: 'shared-issue-uuid',
        identifier: 'LOBE-10966',
        title: 'Owner issue title',
        url: 'https://linear.app/lobehub/issue/LOBE-10966/shared-issue',
      },
      toolCallId: 'tool-call-linear-owner-issue',
      toolName: 'save_issue',
      topicId,
    });
    const otherWork = await otherWorkModel.handleSkillToolResult({
      provider: 'linear',
      args: { id: 'shared-issue-uuid', title: 'Other user issue title' },
      data: {
        id: 'shared-issue-uuid',
        identifier: 'LOBE-10966',
        title: 'Other user issue title',
        url: 'https://linear.app/lobehub/issue/LOBE-10966/shared-issue',
      },
      toolCallId: 'tool-call-linear-other-issue',
      toolName: 'save_issue',
      topicId: otherTopicId,
    });

    expect(ownerWork?.id).not.toBe(otherWork?.id);

    const ownerItems = await workModel.listByConversation({ topicId });
    const otherItems = await otherWorkModel.listByConversation({ topicId: otherTopicId });
    expect(ownerItems).toHaveLength(1);
    expect(ownerItems[0]).toMatchObject({
      id: ownerWork!.id,
      resourceId: 'shared-issue-uuid',
      title: 'Owner issue title',
      type: 'external',
    });
    expect(otherItems).toHaveLength(1);
    expect(otherItems[0]).toMatchObject({
      id: otherWork!.id,
      title: 'Other user issue title',
      type: 'external',
    });
  });
});

/**
 * The persisted url reaches shell.openExternal on desktop, and Linear tool
 * payloads are member-controlled, so only http(s) URLs may be stored.
 */
describe('normalizeLinearToolResult (url scheme allowlist)', () => {
  const registerIssueWithUrl = (url: string) =>
    normalizeLinearToolResult({
      data: { id: 'issue-uuid', identifier: 'LOBE-1', title: 'T', url },
      toolName: 'save_issue',
    });

  it.each([['javascript:alert(1)'], ['data:text/html,x'], ['file:///etc/passwd']])(
    'drops the persisted url for %s',
    (url) => {
      const operation = registerIssueWithUrl(url);

      // Identity is still resolved from the payload; only the unsafe url is dropped.
      expect(operation?.params.identifier).toBe('LOBE-1');
      expect(operation?.params.url).toBeUndefined();
    },
  );

  it('keeps a whitespace-padded https url after trimming', () => {
    const operation = registerIssueWithUrl('  https://linear.app/lobehub/issue/LOBE-1  ');

    expect(operation?.params.url).toBe('https://linear.app/lobehub/issue/LOBE-1');
  });

  it('keeps a plain https url', () => {
    const operation = registerIssueWithUrl('https://linear.app/lobehub/issue/LOBE-1');

    expect(operation?.params.url).toBe('https://linear.app/lobehub/issue/LOBE-1');
  });
});
