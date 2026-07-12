// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { topics, works } from '../../../schemas';
import { WorkModel } from '..';
import {
  cleanupWorkTestData,
  expectLinearSnapshot,
  expectLinearSummaryItem,
  seedWorkTestData,
  serverDB,
  topicId,
  userId,
  userId2,
} from './_fixtures';

beforeEach(seedWorkTestData);
afterEach(cleanupWorkTestData);

describe('WorkModel · linear', () => {
  it('re-reads the current snapshot when a version-create retry follows a concurrent write', async () => {
    const workModel = new WorkModel(serverDB, userId);
    const baseParams = {
      resourceId: 'issue-race',
      resourceType: 'linear_issue' as const,
      source: 'save_issue',
      topicId,
    };

    const first = await workModel.registerLinear({
      ...baseParams,
      description: 'Original description',
      patchFields: ['title', 'status', 'description'],
      role: 'created',
      rootOperationId: 'op-race-create',
      sourceToolCallId: 'tool-call-race-create',
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

      await workModel.registerLinear({
        ...baseParams,
        patchFields: ['title'],
        role: 'updated',
        rootOperationId: 'op-race-winner',
        sourceToolCallId: 'tool-call-race-winner',
        title: 'Winner title',
      });

      throw new Error(
        'duplicate key value violates unique constraint "work_versions_work_id_version_unique"',
      );
    }) as never);

    try {
      await workModel.registerLinear({
        ...baseParams,
        patchFields: ['status'],
        role: 'updated',
        rootOperationId: 'op-race-loser',
        sourceToolCallId: 'tool-call-race-loser',
        status: 'In Progress',
      });
    } finally {
      transactionSpy.mockRestore();
    }

    const versions = await workModel.listVersions(first!.id);
    expect(versions.map((item) => item.version)).toEqual([3, 2, 1]);

    // Without re-reading inside the retry, the retried version would merge
    // against the pre-race snapshot and revert the winner's committed title.
    const latest = expectLinearSnapshot(versions[0].snapshot);
    expect(latest.title).toBe('Winner title');
    expect(latest.status).toBe('In Progress');
    expect(latest.description).toBe('Original description');
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
      sourceToolCallId: 'tool-call-linear-issue-create',
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
      sourceToolCallId: 'tool-call-linear-issue-edit',
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
      sourceToolCallId: 'tool-call-linear-issue-edit',
      toolName: 'save_issue',
      topicId,
    });

    expect(second?.id).toBe(first?.id);
    expect(replay?.id).toBe(first?.id);
    expect(second).toMatchObject({
      resourceId: 'issue-uuid-10966',
      resourceIdentifier: 'LOBE-10966',
      resourceType: 'linear_issue',
      type: 'linear',
    });

    const versions = await workModel.listVersions(first!.id);
    expect(versions.map((item) => item.version)).toEqual([2, 1]);
    expect(versions[0].role).toBe('updated');
    expect(expectLinearSnapshot(versions[0].snapshot)).toMatchObject({
      description: 'Track Linear issue as Work',
      id: 'issue-uuid-10966',
      identifier: 'LOBE-10966',
      labels: ['claude code'],
      priority: 'High',
      priorityValue: 2,
      status: 'In Progress',
      statusType: 'started',
      team: 'Engineering',
      teamId: 'team-1',
      title: 'Linear Work issue',
      updatedAt: '2026-07-01T13:23:10.614Z',
    });
    expect(expectLinearSnapshot(versions[0].snapshot)).not.toHaveProperty('raw');
    expect(expectLinearSnapshot(versions[1].snapshot).status).toBe('Backlog');
    expect(expectLinearSnapshot(versions[1].snapshot)).toMatchObject({
      labels: ['claude code'],
      priority: 'High',
      priorityValue: 2,
      team: 'Engineering',
      teamId: 'team-1',
    });

    const byOperation = await workModel.listSummariesByRootOperations({
      rootOperationIds: ['op-linear-issue-create', 'op-linear-issue-edit'],
    });
    expect(byOperation['op-linear-issue-create']).toEqual([]);
    const issueSummary = expectLinearSummaryItem(byOperation['op-linear-issue-edit']?.[0]);
    expect(issueSummary.linear).toMatchObject({
      identifier: 'LOBE-10966',
      labels: ['claude code'],
      priority: 'High',
      status: 'In Progress',
      team: 'Engineering',
    });

    const byConversation = await workModel.listByConversation({ topicId });
    expect(byConversation).toHaveLength(1);
    expect(byConversation[0]).toMatchObject({
      linear: expect.objectContaining({ identifier: 'LOBE-10966' }),
      resourceType: 'linear_issue',
      type: 'linear',
    });

    await workModel.handleSkillToolResult({
      provider: 'linear',
      data: { id: 'issue-uuid-read', title: 'Read only' },
      sourceToolCallId: 'tool-call-linear-read',
      toolName: 'get_issue',
      topicId,
    });
    await workModel.handleSkillToolResult({
      provider: 'linear',
      data: { error: 'Invalid issue', isError: true },
      sourceToolCallId: 'tool-call-linear-error',
      toolName: 'save_issue',
      topicId,
    });

    const workRows = await serverDB
      .select()
      .from(works)
      .where(eq(works.resourceType, 'linear_issue'));
    expect(workRows).toHaveLength(1);
  });

  it('registers Linear documents and keeps merged snapshots across partial updates', async () => {
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
      sourceToolCallId: 'tool-call-linear-document-create',
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
      sourceToolCallId: 'tool-call-linear-document-edit',
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
      sourceToolCallId: 'tool-call-linear-document-partial-edit',
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
      sourceToolCallId: 'tool-call-linear-comment-create',
      toolName: 'save_comment',
      topicId,
    });
    expect(comment).toBeNull();

    expect(document).toMatchObject({
      resourceId: 'doc-1',
      resourceIdentifier: 'linear-document',
      resourceType: 'linear_document',
      type: 'linear',
    });
    expect(editedDocument).toMatchObject({
      resourceIdentifier: 'linear-document-8298fa69b2e3',
    });
    expect(partialDocumentUpdate).toMatchObject({
      resourceIdentifier: 'linear-document-8298fa69b2e3',
    });

    const documentVersions = await workModel.listVersions(document!.id);
    expect(documentVersions.map((item) => item.version)).toEqual([3, 2, 1]);
    expect(expectLinearSnapshot(documentVersions[0].snapshot)).toMatchObject({
      content: 'Partial body',
      id: 'doc-1',
      identifier: 'linear-document-8298fa69b2e3',
      slugId: '8298fa69b2e3',
      title: 'Linear document updated',
    });
    expect(expectLinearSnapshot(documentVersions[1].snapshot)).toMatchObject({
      content: 'Updated body',
      identifier: 'linear-document-8298fa69b2e3',
    });

    await workModel.handleSkillToolResult({
      provider: 'linear',
      args: { id: 'comment-1' },
      data: { id: 'comment-1' },
      sourceToolCallId: 'tool-call-linear-comment-delete',
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
      sourceToolCallId: 'tool-call-linear-owner-issue',
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
      sourceToolCallId: 'tool-call-linear-other-issue',
      toolName: 'save_issue',
      topicId: otherTopicId,
    });

    expect(ownerWork?.id).not.toBe(otherWork?.id);

    const ownerItems = await workModel.listByConversation({ topicId });
    const otherItems = await otherWorkModel.listByConversation({ topicId: otherTopicId });
    expect(ownerItems).toHaveLength(1);
    expect(ownerItems[0]).toMatchObject({
      id: ownerWork!.id,
      linear: expect.objectContaining({ title: 'Owner issue title' }),
      resourceId: 'shared-issue-uuid',
      type: 'linear',
    });
    expect(otherItems).toHaveLength(1);
    expect(otherItems[0]).toMatchObject({
      id: otherWork!.id,
      linear: expect.objectContaining({ title: 'Other user issue title' }),
      type: 'linear',
    });
  });
});
