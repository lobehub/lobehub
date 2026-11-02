// @vitest-environment node
import type { RegisterCanvasWorkParams, RegisterExternalWorkParams } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentDocuments, agents, documents, topics, users, workVersions } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { WorkModel } from '..';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'work-cov-user';
const otherUserId = 'work-cov-other';
const topicId = 'work-cov-topic';
const agentId = 'work-cov-agent';

const externalParams = (
  overrides: Partial<RegisterExternalWorkParams> = {},
): RegisterExternalWorkParams => ({
  changeType: 'created',
  resourceId: 'LOB-cov-1',
  resourceType: 'linear_issue',
  title: 'Coverage issue',
  toolIdentifier: 'linear',
  toolName: 'save_issue',
  ...overrides,
});

const canvasParams = (
  overrides: Partial<RegisterCanvasWorkParams> = {},
): RegisterCanvasWorkParams => ({
  canvasId: 'cvs_work_cov',
  metadata: {
    entry: 'index.html',
    fileCount: 1,
    manifestKey: 'canvas/work-cov/manifests/a.json',
    runtimeMajor: 1,
    totalSize: 128,
  },
  title: 'Coverage canvas',
  toolCallId: 'call-canvas-cov',
  toolIdentifier: 'lobe-canvas',
  toolName: 'createCanvas',
  ...overrides,
});

const insertDocument = async (owner = userId) => {
  const [doc] = await serverDB
    .insert(documents)
    .values({
      content: 'Body',
      fileType: 'text/markdown',
      source: 'work-coverage.md',
      sourceType: 'api',
      title: 'Coverage doc',
      totalCharCount: 4,
      totalLineCount: 1,
      userId: owner,
    })
    .returning();
  return doc;
};

const model = () => new WorkModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values({ id: topicId, userId });
  await serverDB.insert(agents).values({ id: agentId, title: 'Coverage agent', userId });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('WorkModel coverage · canvas', () => {
  it('stores a null description when the canvas registration omits one', async () => {
    const work = await model().registerCanvas(canvasParams());

    expect(work.description).toBeNull();
    expect(await model().listCanvases({})).toEqual([expect.objectContaining({ id: work.id })]);
  });

  it('finds only the caller’s referenced manifest keys', async () => {
    await model().registerCanvas(canvasParams());

    expect(await model().findReferencedCanvasManifestKeys([])).toEqual([]);
    expect(
      await model().findReferencedCanvasManifestKeys([
        'canvas/work-cov/manifests/a.json',
        'canvas/work-cov/manifests/missing.json',
      ]),
    ).toEqual(['canvas/work-cov/manifests/a.json']);
    expect(
      await new WorkModel(serverDB, otherUserId).findReferencedCanvasManifestKeys([
        'canvas/work-cov/manifests/a.json',
      ]),
    ).toEqual([]);
  });
});

describe('WorkModel coverage · cost', () => {
  it('sums versions without a root operation as independent operations', async () => {
    const work = await model().registerExternal(
      externalParams({ cumulativeCost: 0.5, toolCallId: 'call-cost-1' }),
    );
    await model().registerExternal(
      externalParams({ cumulativeCost: 0.25, toolCallId: 'call-cost-2' }),
    );

    const page = await model().listByWorkspace({});

    expect(page.items).toEqual([expect.objectContaining({ id: work!.id, totalCost: 0.75 })]);
  });
});

describe('WorkModel coverage · document', () => {
  it('returns null for a document the caller cannot resolve', async () => {
    expect(
      await model().registerDocument({
        changeType: 'created',
        documentId: 'docs_missing',
        toolIdentifier: 'lobe-agent-documents',
        toolName: 'createDocument',
      }),
    ).toBeNull();
  });

  it('stores null version metadata without an agent document binding', async () => {
    const doc = await insertDocument();

    const work = await model().registerDocument({
      changeType: 'created',
      documentId: doc.id,
      toolIdentifier: 'lobe-agent-documents',
      toolName: 'createDocument',
    });

    const [version] = await serverDB
      .select({ metadata: workVersions.metadata })
      .from(workVersions)
      .where(eq(workVersions.workId, work!.id));
    expect(version.metadata).toBeNull();
  });

  it('accepts a binding without agentId but rejects one bound to another document', async () => {
    const doc = await insertDocument();
    const otherDoc = await insertDocument();
    const [binding] = await serverDB
      .insert(agentDocuments)
      .values({ agentId, documentId: doc.id, userId })
      .returning();

    const bound = await model().registerDocument({
      agentDocumentId: binding.id,
      changeType: 'created',
      documentId: doc.id,
      toolIdentifier: 'lobe-agent-documents',
      toolName: 'createDocument',
    });
    expect(bound).toMatchObject({ resourceId: doc.id, resourceType: 'document' });

    expect(
      await model().registerDocument({
        agentDocumentId: binding.id,
        changeType: 'created',
        documentId: otherDoc.id,
        toolIdentifier: 'lobe-agent-documents',
        toolName: 'createDocument',
      }),
    ).toBeNull();
  });
});

describe('WorkModel coverage · file and task', () => {
  it('stores null identifier and url for a path without a basename and no file url', async () => {
    const work = await model().registerFile({
      filePath: '/',
      metadata: {
        fileId: 'file-cov',
        filePath: '/',
        fileSize: 0,
        linesAdded: 0,
        linesDeleted: 0,
        mimeType: 'application/octet-stream',
      },
      title: 'root',
      toolCallId: 'op:file-cov',
      toolIdentifier: 'lobe-cloud-sandbox',
      toolName: 'writeFile',
      topicId,
      userId,
    });

    expect(work).toMatchObject({ description: '/', identifier: null, url: null });
  });

  it('returns null when a task registration names no task', async () => {
    expect(
      await model().registerTask({
        changeType: 'created',
        toolIdentifier: 'lobe-task',
        toolName: 'createTask',
      }),
    ).toBeNull();
  });
});

describe('WorkModel coverage · facade', () => {
  it('ignores a skill tool result from an unknown provider', async () => {
    expect(
      await model().handleSkillToolResult({
        data: { id: 'x' },
        provider: 'notion',
        toolName: 'save_page',
      }),
    ).toBeNull();
  });

  it('registers a shell gh result under the producing tool identifier', async () => {
    const work = await model().registerShellGithubResult({
      data: {
        command: `gh issue create --repo lobehub/lobehub --title 'Shell issue'`,
        exitCode: 0,
        output: 'https://github.com/lobehub/lobehub/issues/4242',
      },
      toolIdentifier: 'codex',
      toolName: 'command_execution',
    });

    expect(work).toMatchObject({
      resourceId: 'lobehub/lobehub#4242',
      resourceType: 'github_issue',
      title: 'Shell issue',
      toolIdentifier: 'codex',
    });
  });

  it('returns null for a shell result that ran no gh write', async () => {
    expect(
      await model().registerShellGithubResult({
        data: { command: 'ls -la', exitCode: 0, output: '' },
        toolIdentifier: 'codex',
        toolName: 'command_execution',
      }),
    ).toBeNull();
  });
});

describe('WorkModel coverage · queries', () => {
  it('caps each root operation’s version events at the limit', async () => {
    await model().registerExternal(
      externalParams({ resourceId: 'LOB-cap-1', rootOperationId: 'op-cap', toolCallId: 'c1' }),
    );
    const latest = await model().registerExternal(
      externalParams({ resourceId: 'LOB-cap-2', rootOperationId: 'op-cap', toolCallId: 'c2' }),
    );

    const map = await model().listByRootOperations({
      limit: 1,
      rootOperationIds: ['op-cap', 'op-cap-empty'],
    });

    expect(map['op-cap']).toEqual([expect.objectContaining({ id: latest!.id })]);
    expect(map['op-cap-empty']).toEqual([]);
  });

  it('returns no summaries for a null root operation list', async () => {
    expect(await model().listSummariesByRootOperations({ rootOperationIds: null })).toEqual({});
  });

  it('caps each root operation’s summaries at the limit', async () => {
    await model().registerExternal(
      externalParams({ resourceId: 'LOB-sum-1', rootOperationId: 'op-sum', toolCallId: 's1' }),
    );
    await model().registerExternal(
      externalParams({ resourceId: 'LOB-sum-2', rootOperationId: 'op-sum', toolCallId: 's2' }),
    );

    // A second requested id widens the anchor scan to two rows, so both Works
    // anchor on op-sum and the per-operation cap has to drop one.
    const map = await model().listSummariesByRootOperations({
      limit: 1,
      rootOperationIds: ['op-sum', 'op-sum-empty'],
    });

    expect(map['op-sum']).toHaveLength(1);
    expect(map['op-sum-empty']).toEqual([]);
  });

  it('lists a Work once per conversation even when it has several versions there', async () => {
    const work = await model().registerExternal(externalParams({ toolCallId: 'conv-1', topicId }));
    await model().registerExternal(
      externalParams({ title: 'Edited', toolCallId: 'conv-2', topicId }),
    );

    const items = await model().listByConversation({ topicId });

    expect(items.map((item) => item.id)).toEqual([work!.id]);
  });

  it('stops the conversation list at the limit', async () => {
    await model().registerExternal(
      externalParams({ resourceId: 'LOB-conv-a', toolCallId: 'conv-a', topicId }),
    );
    const latest = await model().registerExternal(
      externalParams({ resourceId: 'LOB-conv-b', toolCallId: 'conv-b', topicId }),
    );

    const items = await model().listByConversation({ limit: 1, topicId });

    expect(items.map((item) => item.id)).toEqual([latest!.id]);
  });

  it.each([
    ['without a separator', 'not-a-cursor'],
    ['with an unparseable timestamp', 'yesterday|work-id'],
    ['with an empty id', '2024-01-01T00:00:00.000Z|'],
  ])('ignores a malformed workspace cursor %s', async (_label, cursor) => {
    const work = await model().registerExternal(externalParams({ toolCallId: 'cursor-1' }));

    const page = await model().listByWorkspace({ cursor });

    expect(page.items.map((item) => item.id)).toEqual([work!.id]);
    expect(page.nextCursor).toBeNull();
  });
});
