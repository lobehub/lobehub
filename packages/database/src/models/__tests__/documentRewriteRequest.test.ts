// @vitest-environment node
import { createHeadlessEditor, hashRewriteText } from '@lobehub/editor/headless';
import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { canonicalizeGeneratedMarkdownProof } from '@/server/services/documentRewrite/proof';

import { getTestDB } from '../../core/getTestDB';
import type { DocumentRewriteSelection } from '../../schemas';
import {
  documentCollaborationStates,
  documentHistories,
  documentRewriteRequests,
  documents,
  topics,
  users,
  workspaceMembers,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DocumentModel } from '../document';
import {
  DOCUMENT_REWRITE_ACTIVE_LIMIT,
  DOCUMENT_REWRITE_CONTINUATION_CHANGED,
  DOCUMENT_REWRITE_CONTINUATION_DELETED,
  DOCUMENT_REWRITE_MAX_ACTIVE_REQUESTS,
  DOCUMENT_REWRITE_REQUEST_CONFLICT,
  DOCUMENT_REWRITE_REQUEST_NOT_CLAIMED,
  DOCUMENT_REWRITE_WHOLE_DOCUMENT_TARGET,
  DocumentRewriteRequestModel,
} from '../documentRewriteRequest';
import { collectAISessionProjection } from '../documentRewriteRequest.validation';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'document-rewrite-test-user';
const otherUserId = 'document-rewrite-test-other-user';

let documentId: string;
let model: DocumentRewriteRequestModel;

const relativeSelection = (quotedText = 'Original text'): DocumentRewriteSelection => ({
  anchorPos: { assoc: 0, tname: 'root' },
  baseStateVector: 'state-vector',
  capturedAt: '2026-08-28T00:00:00.000Z',
  focusPos: { assoc: 0, tname: 'root' },
  kind: 'relative',
  quotedText,
  quotedTextHash: `hash:${quotedText}`,
  roomId: 'room-document-rewrite',
});

const blockSelection = (
  startNodeId = 'node-target',
  endNodeId = startNodeId,
  startOffset = 0,
  endOffset = 12,
): DocumentRewriteSelection => ({
  endNodeId,
  endOffset,
  kind: 'block',
  quotedText: 'Original text',
  quotedTextHash: 'hash:Original text',
  startNodeId,
  startOffset,
});

const nodeSelection = (
  nodeId: string,
  source = '<main>Artifact</main>',
  roomId = documentId,
): DocumentRewriteSelection => ({
  adapterId: 'artifact',
  endNodeId: nodeId,
  endOffset: 1,
  kind: 'block',
  quotedText: 'Artifact card',
  quotedTextHash: hashRewriteText('Artifact card'),
  roomId,
  sourceHash: hashRewriteText(source),
  startNodeId: nodeId,
  startOffset: 0,
  targetKind: 'node',
  targetNodeId: nodeId,
  targetNodeIds: [nodeId],
});

const createDocument = async (uid = userId, wid?: string) =>
  new DocumentModel(serverDB, uid, wid).create({
    content: 'Original text',
    fileType: 'text/plain',
    source: 'test://document-rewrite',
    sourceType: 'api',
    title: 'Rewrite test document',
    totalCharCount: 13,
    totalLineCount: 1,
    ...(wid ? { visibility: 'public' as const, workspaceId: wid } : {}),
  });

const persistDirectRewriteEvidence = async (
  requestId: string,
  stateVector = 'room-vector-after-persistence',
  editorData: unknown = { root: { children: [] } },
) => {
  const currentDocument = await new DocumentModel(serverDB, userId).findById(documentId);
  if (!currentDocument) throw new Error('Missing test document');
  await serverDB.insert(documentCollaborationStates).values({
    documentId,
    documentUpdatedAt: currentDocument.updatedAt,
    roomId: documentId,
    stateVector,
    userId,
    versionToken: `version-${requestId}`,
  });
  await serverDB.insert(documentHistories).values({
    documentId,
    editorData: editorData as Record<string, unknown>,
    requestId,
    saveSource: 'llm_call',
    savedAt: new Date(),
    source: 'agent_collaboration',
    userId,
  });
};

const persistDirectRewriteHistory = async (requestId: string, editorData: unknown) => {
  await serverDB.insert(documentHistories).values({
    documentId,
    editorData: editorData as Record<string, unknown>,
    requestId,
    saveSource: 'llm_call',
    savedAt: new Date(),
    source: 'agent_collaboration',
    userId,
  });
};

const isRecordValue = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const markGeneratedEditorData = (
  editorData: unknown,
  requestId: string,
  generationId: string,
): void => {
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (!isRecordValue(value) || seen.has(value)) return;
    seen.add(value);
    if (value.type !== 'root') {
      const state = isRecordValue(value.$) ? value.$ : {};
      const properties = isRecordValue(state.properties) ? state.properties : {};
      value.$ = {
        ...state,
        properties: {
          ...properties,
          provenance: { generationId, requestId, source: 'ai' },
        },
      };
    }
    if (Array.isArray(value.children)) value.children.forEach(visit);
    else if (isRecordValue(value.root)) visit(value.root);
  };
  visit(editorData);
};

const generatedEditorDataForMarkdown = (
  markdown: string,
  requestId: string,
  generationId: string,
) => {
  const editor = createHeadlessEditor();
  try {
    editor.hydrateMarkdown(markdown);
    const editorData = editor.export().editorData;
    markGeneratedEditorData(editorData, requestId, generationId);
    return editorData;
  } finally {
    editor.destroy();
  }
};

const createWritingRequest = async (
  rewriteModel: DocumentRewriteRequestModel,
  instruction: string,
  generationId: string,
  workerId: string,
) => {
  const first = await rewriteModel.create({
    agentId: 'agent-rewrite',
    documentId,
    instruction,
    selection: relativeSelection(),
  });
  await rewriteModel.claim(first.request.id, { attempt: 1, workerId });
  await rewriteModel.transition(first.request.id, {
    attempt: 1,
    status: 'syncing',
    workerId,
  });
  await rewriteModel.transition(first.request.id, {
    attempt: 1,
    status: 'thinking',
    workerId,
  });
  await rewriteModel.transition(first.request.id, {
    attempt: 1,
    generationId,
    status: 'writing',
    workerId,
  });
  return first;
};

const persistAISessionProjection = async (
  sessionId: string,
  text: string,
  provenance: Record<string, string> = {},
) => {
  const editorData = {
    root: {
      children: [
        {
          $: {
            properties: {
              provenance: { ...provenance, sessionId, source: 'ai' },
            },
          },
          text,
          type: 'text',
        },
      ],
    },
  };
  await serverDB.update(documents).set({ editorData }).where(eq(documents.id, documentId));
  return editorData;
};

const persistAIBlockSessionProjection = async (
  sessionId: string,
  nodeId: string,
  source: string,
  type = 'artifact',
) => {
  await serverDB
    .update(documents)
    .set({
      editorData: {
        root: {
          children: [
            {
              $: {
                properties: {
                  nodeId,
                  provenance: { sessionId, source: 'ai' },
                },
              },
              ...(type === 'artifact' ? { html: source, title: 'Artifact' } : {}),
              ...(type === 'code'
                ? {
                    children: [{ text: source, type: 'text' }],
                  }
                : {}),
              type,
            },
          ],
        },
      },
    })
    .where(eq(documents.id, documentId));
};

const createAppliedSession = async (outputText = 'A concise sentence.') => {
  const first = await model.create({
    agentId: 'agent-rewrite',
    documentId,
    instruction: 'Make the sentence concise',
    selection: relativeSelection(),
  });
  await model.claim(first.request.id, { attempt: 1, workerId: 'worker-session' });
  await model.transition(first.request.id, {
    attempt: 1,
    status: 'syncing',
    workerId: 'worker-session',
  });
  await model.transition(first.request.id, {
    attempt: 1,
    status: 'thinking',
    workerId: 'worker-session',
  });
  await model.transition(first.request.id, {
    attempt: 1,
    generationId: 'generation-session-helper',
    status: 'writing',
    workerId: 'worker-session',
  });
  const editorData = await persistAISessionProjection(first.request.sessionId!, outputText, {
    generationId: 'generation-session-helper',
    requestId: first.request.id,
  });
  await persistDirectRewriteEvidence(first.request.id, 'room-vector-after-persistence', editorData);
  await model.markDirectApplied(first.request.id, {
    attempt: 1,
    commandId: 'command-session-helper',
    generationId: 'generation-session-helper',
    outputText,
    workerId: 'worker-session',
  });
  return first;
};

const createAppliedNodeSession = async (
  nodeId = 'artifact-node-applied',
  source = '<main>Applied artifact</main>',
  outputSource = source,
) => {
  const first = await model.create({
    agentId: 'agent-rewrite',
    documentId,
    instruction: 'Rewrite the artifact',
    selection: nodeSelection(nodeId, source),
  });
  await model.claim(first.request.id, { attempt: 1, workerId: 'worker-node-session' });
  await model.transition(first.request.id, {
    attempt: 1,
    status: 'syncing',
    workerId: 'worker-node-session',
  });
  await model.transition(first.request.id, {
    attempt: 1,
    status: 'thinking',
    workerId: 'worker-node-session',
  });
  await model.transition(first.request.id, {
    attempt: 1,
    generationId: 'generation-node-session-helper',
    status: 'writing',
    workerId: 'worker-node-session',
  });
  await persistDirectRewriteEvidence(first.request.id);
  await model.markDirectApplied(first.request.id, {
    attempt: 1,
    commandId: 'command-node-session-helper',
    generationId: 'generation-node-session-helper',
    outputText: outputSource,
    workerId: 'worker-node-session',
  });
  await persistAIBlockSessionProjection(first.request.sessionId!, nodeId, outputSource);
  return first;
};

beforeEach(async () => {
  await serverDB
    .delete(documentRewriteRequests)
    .where(inArray(documentRewriteRequests.requestedByUserId, [userId, otherUserId]));
  await serverDB.delete(documents).where(inArray(documents.userId, [userId, otherUserId]));
  await serverDB
    .delete(topics)
    .where(
      and(eq(topics.trigger, 'document_rewrite'), inArray(topics.userId, [userId, otherUserId])),
    );
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  const document = await createDocument();
  documentId = document.id;
  model = new DocumentRewriteRequestModel(serverDB, userId);
});

afterEach(async () => {
  await serverDB
    .delete(documentRewriteRequests)
    .where(inArray(documentRewriteRequests.requestedByUserId, [userId, otherUserId]));
  await serverDB.delete(documents).where(inArray(documents.userId, [userId, otherUserId]));
  await serverDB
    .delete(topics)
    .where(
      and(eq(topics.trigger, 'document_rewrite'), inArray(topics.userId, [userId, otherUserId])),
    );
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('DocumentRewriteRequestModel', () => {
  it('creates an idempotent request and rejects a conflicting replay', async () => {
    const input = {
      agentId: 'agent-rewrite',
      documentId,
      id: 'rwr_idempotent',
      instruction: 'Rewrite this sentence to be concise',
      model: 'model-1',
      provider: 'provider-1',
      selection: relativeSelection(),
    };

    const first = await model.create(input);
    const second = await model.create(input);
    expect(first.isDuplicate).toBe(false);
    expect(second.isDuplicate).toBe(true);
    expect(second.request.id).toBe(first.request.id);
    expect(second.request.version).toBe(first.request.version);
    expect(second.request.selection).toEqual(input.selection);
    expect(first.request.model).toBeNull();
    expect(first.request.provider).toBeNull();
    expect(first.request.requestedModel).toBe('model-1');
    expect(first.request.requestedProvider).toBe('provider-1');
    expect(first.request.topicId).toBeTruthy();
    const [topic] = await serverDB
      .select()
      .from(topics)
      .where(eq(topics.id, first.request.topicId!));
    expect(topic).toMatchObject({
      metadata: { documentRewrite: { agentId: 'agent-rewrite', documentId } },
      model: 'model-1',
      provider: 'provider-1',
      trigger: 'document_rewrite',
    });

    await expect(
      model.create({ ...input, instruction: 'A different instruction' }),
    ).rejects.toThrow(DOCUMENT_REWRITE_REQUEST_CONFLICT);
  });

  it('creates a server-owned continuation and returns only bounded completed session context', async () => {
    const first = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Make the sentence concise',
      selection: relativeSelection(),
    });
    expect(first.request.sessionId).toMatch(/^rws_/);
    expect(first.request.turnIndex).toBe(1);
    expect(first.request.parentRequestId).toBeNull();

    await model.claim(first.request.id, { attempt: 1, workerId: 'worker-session' });
    await model.transition(first.request.id, {
      attempt: 1,
      status: 'syncing',
      workerId: 'worker-session',
    });
    await model.transition(first.request.id, {
      attempt: 1,
      status: 'thinking',
      workerId: 'worker-session',
    });
    await model.transition(first.request.id, {
      attempt: 1,
      generationId: 'generation-session-1',
      status: 'writing',
      workerId: 'worker-session',
    });
    const editorData = await persistAISessionProjection(
      first.request.sessionId!,
      'A concise sentence.',
      { generationId: 'generation-session-1', requestId: first.request.id },
    );
    await persistDirectRewriteEvidence(
      first.request.id,
      'room-vector-after-persistence',
      editorData,
    );
    const applied = await model.markDirectApplied(first.request.id, {
      attempt: 1,
      commandId: 'command-session-1',
      generationId: 'generation-session-1',
      outputText: 'A concise sentence.',
      workerId: 'worker-session',
    });
    expect(applied?.request.outputText).toBe('A concise sentence.');

    const next = await model.continue(first.request.id, {
      instruction: 'Make it warmer',
      model: 'model-2',
      provider: 'provider-2',
    });
    expect(next?.request).toMatchObject({
      parentRequestId: first.request.id,
      sessionId: first.request.sessionId,
      turnIndex: 2,
      status: 'queued',
    });
    expect(next?.request).toMatchObject({
      model: null,
      provider: null,
      requestedModel: 'model-2',
      requestedProvider: 'provider-2',
    });
    expect(next?.request.operationId).not.toBe(first.request.operationId);
    expect(next?.request.selection).toMatchObject({
      quotedText: 'A concise sentence.',
    });
  });

  it('preserves captured quote whitespace so the stored hash remains aligned', async () => {
    const quotedText = '\nOriginal text\n';
    const selection = {
      ...relativeSelection(quotedText),
      quotedTextHash: hashRewriteText(quotedText),
    };
    const created = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Keep the captured range exact',
      selection,
    });

    expect(created.request.selection.quotedText).toBe(selection.quotedText);
    expect(created.request.selection.quotedTextHash).toBe(selection.quotedTextHash);
  });

  it('rejects continuation when the persisted session provenance is missing', async () => {
    const first = await createAppliedSession();
    await serverDB
      .update(documents)
      .set({ editorData: { root: { children: [] } } })
      .where(eq(documents.id, documentId));

    await expect(
      model.continue(first.request.id, { instruction: 'Make it warmer' }),
    ).rejects.toThrow(DOCUMENT_REWRITE_CONTINUATION_DELETED);
  });

  it('rejects continuation when the persisted session output changed', async () => {
    const first = await createAppliedSession();
    await persistAISessionProjection(first.request.sessionId!, 'A different sentence.');

    await expect(
      model.continue(first.request.id, { instruction: 'Make it warmer' }),
    ).rejects.toThrow(DOCUMENT_REWRITE_CONTINUATION_CHANGED);
  });

  it('stores and validates the durable applied text hash for Markdown output', async () => {
    const outputText = '**Bold** `sort`\n\n- First\n- Second';
    const markdownModel = new DocumentRewriteRequestModel(serverDB, userId, undefined, {
      canonicalizeRewriteText: () => 'BoldsortFirstSecond',
    });
    const appliedEditorData = {
      root: {
        children: [
          {
            children: [
              {
                $: { properties: { provenance: { sessionId: 'session-markdown', source: 'ai' } } },
                text: 'Bold',
                type: 'text',
              },
              {
                $: { properties: { provenance: { sessionId: 'session-markdown', source: 'ai' } } },
                text: 'sort',
                type: 'text',
              },
            ],
            type: 'paragraph',
          },
          {
            children: [
              {
                children: [
                  {
                    $: {
                      properties: { provenance: { sessionId: 'session-markdown', source: 'ai' } },
                    },
                    text: 'First',
                    type: 'text',
                  },
                ],
                type: 'listitem',
              },
              {
                children: [
                  {
                    $: {
                      properties: { provenance: { sessionId: 'session-markdown', source: 'ai' } },
                    },
                    text: 'Second',
                    type: 'text',
                  },
                ],
                type: 'listitem',
              },
            ],
            type: 'list',
          },
        ],
      },
    };
    const first = await markdownModel.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Format the text',
      selection: { ...relativeSelection(), quotedText: 'Original text' },
      sessionId: 'session-markdown',
    });
    await markdownModel.claim(first.request.id, { attempt: 1, workerId: 'worker-markdown' });
    await markdownModel.transition(first.request.id, {
      attempt: 1,
      status: 'syncing',
      workerId: 'worker-markdown',
    });
    await markdownModel.transition(first.request.id, {
      attempt: 1,
      status: 'thinking',
      workerId: 'worker-markdown',
    });
    await markdownModel.transition(first.request.id, {
      attempt: 1,
      generationId: 'generation-markdown',
      status: 'writing',
      workerId: 'worker-markdown',
    });
    const attachRequestMetadata = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(attachRequestMetadata);
        return;
      }
      const record = value as Record<string, unknown>;
      const state = record.$ as Record<string, unknown> | undefined;
      const properties = state?.properties as Record<string, unknown> | undefined;
      const provenance = properties?.provenance as Record<string, unknown> | undefined;
      if (provenance?.sessionId === 'session-markdown') {
        provenance.generationId = 'generation-markdown';
        provenance.requestId = first.request.id;
      }
      Object.values(record).forEach(attachRequestMetadata);
    };
    attachRequestMetadata(appliedEditorData);
    expect(JSON.stringify(appliedEditorData)).toContain(first.request.id);
    await serverDB
      .update(documents)
      .set({ editorData: appliedEditorData })
      .where(eq(documents.id, documentId));
    await persistDirectRewriteEvidence(first.request.id, 'markdown-room-vector', appliedEditorData);
    const [historyForProof] = await serverDB
      .select({ editorData: documentHistories.editorData })
      .from(documentHistories)
      .where(eq(documentHistories.requestId, first.request.id));
    expect(
      collectAISessionProjection(historyForProof?.editorData, first.request.sessionId!),
    ).toMatchObject({
      rangeCount: 4,
    });

    const applied = await markdownModel.markDirectApplied(first.request.id, {
      attempt: 1,
      commandId: 'command-markdown',
      generationId: 'generation-markdown',
      outputText,
      workerId: 'worker-markdown',
    });
    expect(applied?.request.selection.appliedTextHash).toBe(hashRewriteText('BoldsortFirstSecond'));

    const replay = await markdownModel.create({
      agentId: 'agent-rewrite',
      documentId,
      id: first.request.id,
      instruction: 'Format the text',
      selection: relativeSelection(),
    });
    expect(replay.isDuplicate).toBe(true);
    expect(replay.request.selection.appliedTextHash).toBe(hashRewriteText('BoldsortFirstSecond'));

    const next = await markdownModel.continue(first.request.id, { instruction: 'Make it warmer' });
    expect(next?.request.status).toBe('queued');
    expect(next?.request.selection.quotedText).not.toBe(outputText);
    expect(next?.request.selection.quotedText).toContain('First');

    await serverDB
      .update(documents)
      .set({
        editorData: {
          ...appliedEditorData,
          root: {
            ...appliedEditorData.root,
            children: [
              {
                ...appliedEditorData.root.children[0],
                children: [
                  {
                    ...(
                      appliedEditorData.root.children[0] as { children: Record<string, unknown>[] }
                    ).children[0],
                    text: 'Changed',
                  },
                ],
              },
            ],
          },
        },
      })
      .where(eq(documents.id, documentId));
    await expect(
      markdownModel.continue(first.request.id, { instruction: 'Reject the changed output' }),
    ).rejects.toThrow(DOCUMENT_REWRITE_CONTINUATION_CHANGED);
  });

  it('keeps the complete expected output for recovery without prematurely applying it', async () => {
    const proofModel = new DocumentRewriteRequestModel(serverDB, userId, undefined, {
      canonicalizeRewriteProof: canonicalizeGeneratedMarkdownProof,
    });
    const generationId = 'generation-output-checkpoint';
    const first = await createWritingRequest(
      proofModel,
      'Complete this',
      generationId,
      'worker-checkpoint',
    );
    const outputText = 'Complete output';
    const input = {
      attempt: 1,
      commandId: 'command-checkpoint',
      generationId,
      outputText,
      workerId: 'worker-checkpoint',
    };

    expect(await proofModel.markDirectApplied(first.request.id, input)).toBeUndefined();
    expect(await proofModel.findById(first.request.id)).toMatchObject({
      status: 'writing',
      outputText,
    });
    expect(
      await proofModel.markDirectApplied(first.request.id, { ...input, outputText: 'Different' }),
    ).toBeUndefined();
    expect(await proofModel.findById(first.request.id)).toMatchObject({ outputText });

    const editorData = generatedEditorDataForMarkdown(outputText, first.request.id, generationId);
    await persistDirectRewriteEvidence(first.request.id, 'checkpoint-vector', editorData);
    expect((await proofModel.markDirectApplied(first.request.id, input))?.request.status).toBe(
      'applied',
    );
  });

  it('applies a pure fenced-code Markdown rewrite with complete subtree proof', async () => {
    const proofModel = new DocumentRewriteRequestModel(serverDB, userId, undefined, {
      canonicalizeRewriteProof: canonicalizeGeneratedMarkdownProof,
    });
    const outputText = '```js\nconst answer = 42;\n```';
    const generationId = 'generation-code-only';
    const first = await createWritingRequest(
      proofModel,
      'Rewrite this as a code block',
      generationId,
      'worker-code-only',
    );
    const editorData = generatedEditorDataForMarkdown(outputText, first.request.id, generationId);
    await serverDB.update(documents).set({ editorData }).where(eq(documents.id, documentId));
    await persistDirectRewriteEvidence(first.request.id, 'code-only-room-vector', editorData);

    const applied = await proofModel.markDirectApplied(first.request.id, {
      attempt: 1,
      commandId: 'command-code-only',
      generationId,
      outputText,
      workerId: 'worker-code-only',
    });
    expect(applied?.request.status).toBe('applied');
  });

  it('ignores inherited inline formatting while proving generated Markdown content', async () => {
    const proofModel = new DocumentRewriteRequestModel(serverDB, userId, undefined, {
      canonicalizeRewriteProof: canonicalizeGeneratedMarkdownProof,
    });
    const outputText = 'World';
    const generationId = 'generation-inherited-format';
    const first = await createWritingRequest(
      proofModel,
      'Rewrite the bold selection',
      generationId,
      'worker-inherited-format',
    );
    const editorData = generatedEditorDataForMarkdown(outputText, first.request.id, generationId);
    let inheritedFormatMutated = false;
    const markInheritedFormat = (value: unknown): void => {
      if (!isRecordValue(value)) return;
      if (value.type === 'text') {
        value.format = 1;
        inheritedFormatMutated = true;
      }
      if (Array.isArray(value.children)) value.children.forEach(markInheritedFormat);
      else if (isRecordValue(value.root)) markInheritedFormat(value.root);
    };
    markInheritedFormat(editorData);
    expect(inheritedFormatMutated).toBe(true);
    await serverDB.update(documents).set({ editorData }).where(eq(documents.id, documentId));
    await persistDirectRewriteEvidence(
      first.request.id,
      'inherited-format-room-vector',
      editorData,
    );

    const applied = await proofModel.markDirectApplied(first.request.id, {
      attempt: 1,
      commandId: 'command-inherited-format',
      generationId,
      outputText,
      workerId: 'worker-inherited-format',
    });
    expect(applied?.request.status).toBe('applied');
  });

  it('keeps inherited heading and list containers on the text proof path', async () => {
    const proofModel = new DocumentRewriteRequestModel(serverDB, userId, undefined, {
      canonicalizeRewriteProof: canonicalizeGeneratedMarkdownProof,
      canonicalizeRewriteText: () => 'World',
    });
    const clearContainerProvenance = (value: unknown): void => {
      if (!isRecordValue(value)) return;
      if (value.type !== 'text' && value.type !== 'codeInline') {
        const state = isRecordValue(value.$) ? value.$ : {};
        const properties = isRecordValue(state.properties) ? state.properties : {};
        const { provenance: _provenance, ...restProperties } = properties;
        value.$ = { ...state, properties: restProperties };
      }
      if (Array.isArray(value.children)) value.children.forEach(clearContainerProvenance);
      else if (isRecordValue(value.root)) clearContainerProvenance(value.root);
    };

    const headingGeneration = 'generation-inherited-heading';
    const heading = await createWritingRequest(
      proofModel,
      'Rewrite the heading selection',
      headingGeneration,
      'worker-inherited-heading',
    );
    const headingData = generatedEditorDataForMarkdown(
      '# World',
      heading.request.id,
      headingGeneration,
    );
    clearContainerProvenance(headingData);
    await serverDB
      .update(documents)
      .set({ editorData: headingData })
      .where(eq(documents.id, documentId));
    await persistDirectRewriteEvidence(
      heading.request.id,
      'inherited-heading-room-vector',
      headingData,
    );
    const headingApplied = await proofModel.markDirectApplied(heading.request.id, {
      attempt: 1,
      commandId: 'command-inherited-heading',
      generationId: headingGeneration,
      outputText: 'World',
      workerId: 'worker-inherited-heading',
    });
    expect(headingApplied?.request.status).toBe('applied');

    const listGeneration = 'generation-inherited-list';
    const list = await createWritingRequest(
      proofModel,
      'Rewrite the list item selection',
      listGeneration,
      'worker-inherited-list',
    );
    const listData = generatedEditorDataForMarkdown('- `World`', list.request.id, listGeneration);
    clearContainerProvenance(listData);
    await serverDB
      .update(documents)
      .set({ editorData: listData })
      .where(eq(documents.id, documentId));
    await persistDirectRewriteHistory(list.request.id, listData);
    const listApplied = await proofModel.markDirectApplied(list.request.id, {
      attempt: 1,
      commandId: 'command-inherited-list',
      generationId: listGeneration,
      outputText: '`World`',
      workerId: 'worker-inherited-list',
    });
    expect(listApplied?.request.status).toBe('applied');
  });

  it('rejects a mixed Markdown rewrite when the code node is completely missing', async () => {
    const proofModel = new DocumentRewriteRequestModel(serverDB, userId, undefined, {
      canonicalizeRewriteProof: canonicalizeGeneratedMarkdownProof,
    });
    const outputText = 'Intro\n\n```js\nconst answer = 42;\n```\n\nOutro';
    const generationId = 'generation-code-deleted';
    const first = await createWritingRequest(
      proofModel,
      'Rewrite text and include a code block',
      generationId,
      'worker-code-deleted',
    );
    const editorData = generatedEditorDataForMarkdown(
      'Intro\n\nOutro',
      first.request.id,
      generationId,
    );
    await serverDB.update(documents).set({ editorData }).where(eq(documents.id, documentId));
    await persistDirectRewriteEvidence(first.request.id, 'code-deleted-room-vector', editorData);

    const applied = await proofModel.markDirectApplied(first.request.id, {
      attempt: 1,
      commandId: 'command-code-deleted',
      generationId,
      outputText,
      workerId: 'worker-code-deleted',
    });
    expect(applied).toBeUndefined();
  });

  it('rejects a pure-code final payload when the persisted generated forest is empty', async () => {
    const proofModel = new DocumentRewriteRequestModel(serverDB, userId, undefined, {
      canonicalizeRewriteProof: canonicalizeGeneratedMarkdownProof,
    });
    const outputText = '```js\nconst answer = 42;\n```';
    const generationId = 'generation-code-empty';
    const first = await createWritingRequest(
      proofModel,
      'Write a code block',
      generationId,
      'worker-code-empty',
    );
    const editorData = { root: { children: [], type: 'root', version: 1 } };
    await serverDB.update(documents).set({ editorData }).where(eq(documents.id, documentId));
    await persistDirectRewriteEvidence(first.request.id, 'code-empty-room-vector', editorData);

    const applied = await proofModel.markDirectApplied(first.request.id, {
      attempt: 1,
      commandId: 'command-code-empty',
      generationId,
      outputText,
      workerId: 'worker-code-empty',
    });
    expect(applied).toBeUndefined();
  });

  it('rejects a final table payload when the persisted table structure is missing', async () => {
    const proofModel = new DocumentRewriteRequestModel(serverDB, userId, undefined, {
      canonicalizeRewriteProof: canonicalizeGeneratedMarkdownProof,
    });
    const outputText = '| A | B |\n|---|---|\n| 1 | 2 |';
    const generationId = 'generation-table-deleted';
    const first = await createWritingRequest(
      proofModel,
      'Write a table',
      generationId,
      'worker-table-deleted',
    );
    // Keep the same text projection while removing the table node itself.
    const editorData = generatedEditorDataForMarkdown('AB12', first.request.id, generationId);
    await serverDB.update(documents).set({ editorData }).where(eq(documents.id, documentId));
    await persistDirectRewriteEvidence(first.request.id, 'table-deleted-room-vector', editorData);

    const applied = await proofModel.markDirectApplied(first.request.id, {
      attempt: 1,
      commandId: 'command-table-deleted',
      generationId,
      outputText,
      workerId: 'worker-table-deleted',
    });
    expect(applied).toBeUndefined();
  });

  it('rejects a mixed Markdown rewrite when only its code body was changed', async () => {
    const proofModel = new DocumentRewriteRequestModel(serverDB, userId, undefined, {
      canonicalizeRewriteProof: canonicalizeGeneratedMarkdownProof,
    });
    const outputText = 'Intro\n\n```js\nconst answer = 42;\n```\n\nOutro';
    const persistedText = 'Intro\n\n```js\nconst answer = CHANGED;\n```\n\nOutro';
    const generationId = 'generation-code-mismatch';
    const first = await createWritingRequest(
      proofModel,
      'Rewrite text and include a code block',
      generationId,
      'worker-code-mismatch',
    );
    const editorData = generatedEditorDataForMarkdown(
      persistedText,
      first.request.id,
      generationId,
    );
    await serverDB.update(documents).set({ editorData }).where(eq(documents.id, documentId));
    await persistDirectRewriteEvidence(first.request.id, 'code-mismatch-room-vector', editorData);

    const applied = await proofModel.markDirectApplied(first.request.id, {
      attempt: 1,
      commandId: 'command-code-mismatch',
      generationId,
      outputText,
      workerId: 'worker-code-mismatch',
    });
    expect(applied).toBeUndefined();
  });

  it('keeps partial history pending until the complete Markdown subtree arrives', async () => {
    const proofModel = new DocumentRewriteRequestModel(serverDB, userId, undefined, {
      canonicalizeRewriteProof: canonicalizeGeneratedMarkdownProof,
    });
    const outputText = 'Intro\n\n```js\nconst answer = 42;\n```\n\nOutro';
    const generationId = 'generation-code-partial';
    const first = await createWritingRequest(
      proofModel,
      'Stream a complete code block',
      generationId,
      'worker-code-partial',
    );
    const partial = generatedEditorDataForMarkdown('Intro', first.request.id, generationId);
    await serverDB
      .update(documents)
      .set({ editorData: partial })
      .where(eq(documents.id, documentId));
    await persistDirectRewriteEvidence(first.request.id, 'code-partial-room-vector', partial);

    const pending = await proofModel.markDirectApplied(first.request.id, {
      attempt: 1,
      commandId: 'command-code-partial',
      generationId,
      outputText,
      workerId: 'worker-code-partial',
    });
    expect(pending).toBeUndefined();

    const complete = generatedEditorDataForMarkdown(outputText, first.request.id, generationId);
    await serverDB
      .update(documentHistories)
      .set({ editorData: complete })
      .where(eq(documentHistories.requestId, first.request.id));
    const applied = await proofModel.markDirectApplied(first.request.id, {
      attempt: 1,
      commandId: 'command-code-partial',
      generationId,
      outputText,
      workerId: 'worker-code-partial',
    });
    expect(applied?.request.status).toBe('applied');
  });

  it('does not mix generated prefixes from another request into the proof', async () => {
    const proofModel = new DocumentRewriteRequestModel(serverDB, userId, undefined, {
      canonicalizeRewriteProof: canonicalizeGeneratedMarkdownProof,
    });
    const generationId = 'generation-code-scope';
    const second = await createWritingRequest(
      proofModel,
      'Write the scoped target',
      generationId,
      'worker-code-scope',
    );
    const prefixRequestId = 'request-code-prefix-other';
    const prefix = generatedEditorDataForMarkdown(
      'Prefix from another request',
      prefixRequestId,
      'generation-code-prefix',
    );
    const targetText = '```js\nconst scoped = true;\n```';
    const target = generatedEditorDataForMarkdown(targetText, second.request.id, generationId);
    const prefixChildren = (prefix.root as { children?: unknown[] }).children ?? [];
    const targetChildren = (target.root as { children?: unknown[] }).children ?? [];
    const combined = {
      root: {
        ...(target.root as Record<string, unknown>),
        children: [...prefixChildren, ...targetChildren],
      },
    };
    await serverDB
      .update(documents)
      .set({ editorData: combined })
      .where(eq(documents.id, documentId));
    await persistDirectRewriteEvidence(second.request.id, 'code-scope-room-vector', combined);

    const applied = await proofModel.markDirectApplied(second.request.id, {
      attempt: 1,
      commandId: 'command-code-scope',
      generationId,
      outputText: targetText,
      workerId: 'worker-code-scope',
    });
    expect(applied?.request.status).toBe('applied');
  });

  it('preserves block selection shape while refreshing a Markdown text proof', async () => {
    const outputText = '**Bold** `sort`';
    const blockModel = new DocumentRewriteRequestModel(serverDB, userId, undefined, {
      canonicalizeRewriteText: () => 'Bold sort',
    });
    const blockId = 'block-markdown-continuation';
    const editorData = {
      root: {
        children: [
          {
            $: {
              properties: {
                nodeId: blockId,
                provenance: { sessionId: 'session-block-markdown', source: 'ai' },
              },
            },
            children: [
              {
                $: {
                  properties: {
                    provenance: { sessionId: 'session-block-markdown', source: 'ai' },
                  },
                },
                text: 'Bold sort',
                type: 'text',
              },
            ],
            type: 'paragraph',
          },
        ],
      },
    };
    const first = await blockModel.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Format the block',
      selection: blockSelection(blockId, blockId, 0, 13),
      sessionId: 'session-block-markdown',
    });
    const attachBlockRequestMetadata = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(attachBlockRequestMetadata);
        return;
      }
      const record = value as Record<string, unknown>;
      const state = record.$ as Record<string, unknown> | undefined;
      const properties = state?.properties as Record<string, unknown> | undefined;
      const provenance = properties?.provenance as Record<string, unknown> | undefined;
      if (provenance?.sessionId === 'session-block-markdown') {
        provenance.generationId = 'generation-block-markdown';
        provenance.requestId = first.request.id;
      }
      Object.values(record).forEach(attachBlockRequestMetadata);
    };
    attachBlockRequestMetadata(editorData);
    await blockModel.claim(first.request.id, { attempt: 1, workerId: 'worker-block-markdown' });
    await blockModel.transition(first.request.id, {
      attempt: 1,
      status: 'syncing',
      workerId: 'worker-block-markdown',
    });
    await blockModel.transition(first.request.id, {
      attempt: 1,
      status: 'thinking',
      workerId: 'worker-block-markdown',
    });
    await blockModel.transition(first.request.id, {
      attempt: 1,
      generationId: 'generation-block-markdown',
      status: 'writing',
      workerId: 'worker-block-markdown',
    });
    await serverDB.update(documents).set({ editorData }).where(eq(documents.id, documentId));
    await persistDirectRewriteEvidence(first.request.id, 'block-markdown-room', editorData);
    await blockModel.markDirectApplied(first.request.id, {
      attempt: 1,
      commandId: 'command-block-markdown',
      generationId: 'generation-block-markdown',
      outputText,
      workerId: 'worker-block-markdown',
    });

    const next = await blockModel.continue(first.request.id, { instruction: 'Keep formatting' });
    expect(next?.request.selection).toMatchObject({
      endNodeId: blockId,
      endOffset: 13,
      kind: 'block',
      startNodeId: blockId,
      startOffset: 0,
    });
  });

  it('does not apply a final payload against a still-partial request history', async () => {
    const proofModel = new DocumentRewriteRequestModel(serverDB, userId, undefined, {
      canonicalizeRewriteText: () => 'Final text',
    });
    const first = await proofModel.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Complete the stream',
      selection: relativeSelection(),
      sessionId: 'session-final-proof',
    });
    await proofModel.claim(first.request.id, { attempt: 1, workerId: 'worker-final-proof' });
    await proofModel.transition(first.request.id, {
      attempt: 1,
      status: 'syncing',
      workerId: 'worker-final-proof',
    });
    await proofModel.transition(first.request.id, {
      attempt: 1,
      status: 'thinking',
      workerId: 'worker-final-proof',
    });
    await proofModel.transition(first.request.id, {
      attempt: 1,
      generationId: 'generation-final-proof',
      status: 'writing',
      workerId: 'worker-final-proof',
    });
    const projection = (text: string) => ({
      root: {
        children: [
          {
            $: {
              properties: {
                provenance: {
                  generationId: 'generation-final-proof',
                  requestId: first.request.id,
                  sessionId: 'session-final-proof',
                  source: 'ai',
                },
              },
            },
            children: [
              {
                $: {
                  properties: {
                    provenance: {
                      generationId: 'generation-final-proof',
                      requestId: first.request.id,
                      sessionId: 'session-final-proof',
                      source: 'ai',
                    },
                  },
                },
                text,
                type: 'text',
              },
            ],
            type: 'paragraph',
          },
        ],
      },
    });
    const partial = projection('Partial');
    await serverDB
      .update(documents)
      .set({ editorData: partial })
      .where(eq(documents.id, documentId));
    await persistDirectRewriteEvidence(first.request.id, 'final-proof-room', partial);

    const wrongGeneration = await proofModel.markDirectApplied(first.request.id, {
      attempt: 1,
      commandId: 'wrong-generation-command',
      generationId: 'generation-not-owned-by-request',
      outputText: 'Final text',
      workerId: 'worker-final-proof',
    });
    expect(wrongGeneration).toBeUndefined();
    expect((await proofModel.findById(first.request.id))?.status).toBe('writing');

    const pending = await proofModel.markDirectApplied(first.request.id, {
      attempt: 1,
      commandId: 'final-proof-command',
      generationId: 'generation-final-proof',
      outputText: '**Final text**',
      workerId: 'worker-final-proof',
    });
    expect(pending).toBeUndefined();
    expect((await proofModel.findById(first.request.id))?.status).toBe('writing');

    const final = projection('Final text');
    await serverDB.update(documents).set({ editorData: final }).where(eq(documents.id, documentId));
    await serverDB
      .update(documentHistories)
      .set({ editorData: final })
      .where(eq(documentHistories.requestId, first.request.id));
    const applied = await proofModel.markDirectApplied(first.request.id, {
      attempt: 1,
      commandId: 'final-proof-command',
      generationId: 'generation-final-proof',
      outputText: '**Final text**',
      workerId: 'worker-final-proof',
    });
    expect(applied?.request.status).toBe('applied');
  });

  it('continues an adapter-owned node from its persisted node provenance', async () => {
    const source = '<main>Applied artifact</main>';
    const first = await createAppliedNodeSession('artifact-node-session', source);

    const next = await model.continue(first.request.id, { instruction: 'Make it warmer' });
    expect(next?.request).toMatchObject({
      parentRequestId: first.request.id,
      sessionId: first.request.sessionId,
      status: 'queued',
      turnIndex: 2,
    });
    expect(next?.request.selection).toMatchObject({
      adapterId: 'artifact',
      sourceHash: hashRewriteText(source),
      targetKind: 'node',
      targetNodeId: 'artifact-node-session',
      quotedText: 'Artifact',
    });
  });

  it('refreshes a node continuation source proof from the persisted post-apply node', async () => {
    const capturedSource = '<main>Original artifact</main>';
    const appliedSource = '<main>Applied artifact</main>';
    const first = await createAppliedNodeSession(
      'artifact-node-refresh',
      capturedSource,
      appliedSource,
    );

    const next = await model.continue(first.request.id, { instruction: 'Make it warmer' });

    expect(next?.request.selection).toMatchObject({
      quotedText: 'Artifact',
      quotedTextHash: hashRewriteText('Artifact'),
      sourceHash: hashRewriteText(appliedSource),
      targetKind: 'node',
      targetNodeId: 'artifact-node-refresh',
    });
    expect(next?.request.selection.sourceHash).not.toBe(first.request.selection.sourceHash);
  });

  it('allows a new turn after a failed latest turn but never skips an active or applied turn', async () => {
    const first = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Make the sentence concise',
      selection: relativeSelection(),
    });
    await model.claim(first.request.id, { attempt: 1, workerId: 'worker-session' });
    await model.transition(first.request.id, {
      attempt: 1,
      status: 'syncing',
      workerId: 'worker-session',
    });
    await model.transition(first.request.id, {
      attempt: 1,
      status: 'thinking',
      workerId: 'worker-session',
    });
    await model.transition(first.request.id, {
      attempt: 1,
      generationId: 'generation-session-first',
      status: 'writing',
      workerId: 'worker-session',
    });
    const editorData = await persistAISessionProjection(
      first.request.sessionId!,
      'A concise sentence.',
      { generationId: 'generation-session-first', requestId: first.request.id },
    );
    await persistDirectRewriteEvidence(
      first.request.id,
      'room-vector-after-persistence',
      editorData,
    );
    await model.markDirectApplied(first.request.id, {
      attempt: 1,
      commandId: 'command-session-first',
      generationId: 'generation-session-first',
      outputText: 'A concise sentence.',
      workerId: 'worker-session',
    });

    const concurrentContinuations = await Promise.allSettled([
      model.continue(first.request.id, { instruction: 'Make it warmer' }),
      model.continue(first.request.id, { instruction: 'Make it warmer concurrently' }),
    ]);
    expect(concurrentContinuations.filter((result) => result.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(concurrentContinuations.filter((result) => result.status === 'rejected')).toHaveLength(
      1,
    );
    expect(concurrentContinuations.find((result) => result.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({
        message: expect.stringContaining('continuation parent is not the latest turn'),
      }),
    });
    const successfulContinuation = concurrentContinuations.find(
      (result) => result.status === 'fulfilled',
    );
    if (successfulContinuation?.status !== 'fulfilled' || !successfulContinuation.value) {
      throw new Error('Expected one continuation to win the document lock.');
    }
    const failedLatest = successfulContinuation.value;
    expect(failedLatest.request.turnIndex).toBe(2);
    await model.claim(failedLatest.request.id, { attempt: 1, workerId: 'worker-session' });
    await model.transition(failedLatest.request.id, {
      attempt: 1,
      status: 'failed',
      workerId: 'worker-session',
    });

    const resumed = await model.continue(first.request.id, {
      instruction: 'Try the warmer version again',
    });
    expect(resumed?.request).toMatchObject({
      parentRequestId: first.request.id,
      sessionId: first.request.sessionId,
      turnIndex: 3,
      status: 'queued',
    });

    // A new queued turn is still an active stop for another continuation.
    await expect(
      model.continue(first.request.id, { instruction: 'Skip the active turn' }),
    ).rejects.toThrow('continuation parent is not the latest turn');

    // Simulate the durable terminal settlement without re-inserting the
    // single document room-state proof used by markDirectApplied. An applied
    // latest turn remains an unconditional stop and cannot be bypassed.
    await serverDB
      .update(documentRewriteRequests)
      .set({ outputText: 'A warmer sentence.', status: 'applied' })
      .where(eq(documentRewriteRequests.id, resumed!.request.id));
    await expect(
      model.continue(first.request.id, { instruction: 'Skip the applied turn' }),
    ).rejects.toThrow('continuation parent is not the latest turn');
  });

  it('reserves the same durable target for one active request at a time', async () => {
    const first = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Rewrite target',
      selection: blockSelection(),
    });

    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Rewrite the same target again',
        selection: blockSelection(),
      }),
    ).rejects.toThrow(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: target already active`);
    expect((await model.findById(first.request.id))?.targetKey).toBe('node-target');

    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Overlapping range',
        selection: blockSelection('node-target', 'node-other'),
      }),
    ).rejects.toThrow(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: target already active`);

    const relativeWithProjection = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Relative target projection',
      selection: {
        ...relativeSelection(),
        endNodeId: 'node-relative-end',
        endOffset: 12,
        startNodeId: 'node-relative-start',
        startOffset: 0,
        targetNodeIds: ['node-relative-start', 'node-relative-end'],
      },
    });
    expect(relativeWithProjection.request.targetKey).toBe('node-relative-end|node-relative-start');
    expect(relativeWithProjection.request.targetNodeIds).toEqual([
      'node-relative-end',
      'node-relative-start',
    ]);
    expect(relativeWithProjection.request.selection).toMatchObject({
      targetNodeIds: ['node-relative-start', 'node-relative-end'],
    });
    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Block overlaps relative projection',
        selection: blockSelection('node-relative-start'),
      }),
    ).rejects.toThrow(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: target already active`);

    const multiBlock = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Multi-block range',
      selection: {
        ...blockSelection('node-range-start', 'node-range-end'),
        targetNodeIds: ['node-range-start', 'node-range-middle', 'node-range-end'],
      },
    });
    expect(multiBlock.request.targetNodeIds).toEqual([
      'node-range-end',
      'node-range-middle',
      'node-range-start',
    ]);
    expect(multiBlock.request.selection).toMatchObject({
      targetNodeIds: ['node-range-start', 'node-range-middle', 'node-range-end'],
    });
    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Single block inside multi-block range',
        selection: blockSelection('node-range-middle'),
      }),
    ).rejects.toThrow(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: target already active`);
  });

  it('allows disjoint and boundary-touching ranges in one block', async () => {
    const first = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Rewrite the first half',
      selection: blockSelection('node-shared', 'node-shared', 0, 5),
    });

    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Rewrite the adjacent half',
        selection: blockSelection('node-shared', 'node-shared', 5, 10),
      }),
    ).resolves.toMatchObject({ isDuplicate: false, request: { status: 'queued' } });

    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Rewrite the overlap',
        selection: blockSelection('node-shared', 'node-shared', 4, 6),
      }),
    ).rejects.toThrow(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: target already active`);

    expect((await model.findById(first.request.id))?.status).toBe('queued');
  });

  it('reserves adapter-owned nodes exclusively while allowing a different node', async () => {
    const first = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Rewrite the artifact',
      selection: nodeSelection('artifact-node-a'),
    });

    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Rewrite the same artifact again',
        selection: nodeSelection('artifact-node-a', '<main>Changed source</main>'),
      }),
    ).rejects.toThrow(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: target already active`);

    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Rewrite a different artifact',
        selection: nodeSelection('artifact-node-b'),
      }),
    ).resolves.toMatchObject({ isDuplicate: false, request: { status: 'queued' } });
    expect((await model.findById(first.request.id))?.selection).toMatchObject({
      adapterId: 'artifact',
      targetKind: 'node',
      targetNodeId: 'artifact-node-a',
    });
  });

  it('rejects real cross-block overlap while allowing a separate block range', async () => {
    const first = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Rewrite across blocks',
      selection: {
        ...blockSelection('node-cross-a', 'node-cross-c', 4, 3),
        targetNodeIds: ['node-cross-a', 'node-cross-b', 'node-cross-c'],
      },
    });

    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Rewrite the middle overlap',
        selection: {
          ...blockSelection('node-cross-b', 'node-cross-d', 8, 2),
          targetNodeIds: ['node-cross-b', 'node-cross-c', 'node-cross-d'],
        },
      }),
    ).rejects.toThrow(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: target already active`);

    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Rewrite a different block',
        selection: blockSelection('node-cross-other', 'node-cross-other', 0, 4),
      }),
    ).resolves.toMatchObject({ isDuplicate: false, request: { status: 'queued' } });

    expect((await model.findById(first.request.id))?.status).toBe('queued');
  });

  it('preserves document-order UUID targets while canonicalizing only the claim projection', async () => {
    const documentOrder = [
      'f0000000-0000-4000-8000-000000000000',
      '00000000-0000-4000-8000-000000000000',
    ];
    const canonicalOrder = [...documentOrder].sort();
    const created = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Rewrite across UUID blocks',
      selection: {
        ...relativeSelection('UUID ordered text'),
        endNodeId: documentOrder[1],
        endOffset: 12,
        startNodeId: documentOrder[0],
        startOffset: 0,
        targetNodeIds: [documentOrder[0], documentOrder[1], documentOrder[0]],
      },
    });

    expect(created.request.selection).toMatchObject({ targetNodeIds: documentOrder });
    expect(created.request.targetNodeIds).toEqual(canonicalOrder);
    expect(created.request.targetKey).toBe(canonicalOrder.join('|'));
  });

  it('allows different agents to run disjoint targets concurrently but rejects an overlap', async () => {
    const [agentOne, agentTwo] = await Promise.all([
      model.create({
        agentId: 'agent-one',
        documentId,
        id: 'request-agent-one',
        instruction: 'Rewrite the first target',
        selection: blockSelection('node-agent-one'),
      }),
      model.create({
        agentId: 'agent-two',
        documentId,
        id: 'request-agent-two',
        instruction: 'Rewrite the second target',
        selection: blockSelection('node-agent-two'),
      }),
    ]);

    expect(agentOne.request).toMatchObject({ agentId: 'agent-one', status: 'queued' });
    expect(agentTwo.request).toMatchObject({ agentId: 'agent-two', status: 'queued' });
    await expect(
      model.create({
        agentId: 'agent-two',
        documentId,
        id: 'request-agent-two-overlap',
        instruction: 'Rewrite the first target again',
        selection: blockSelection('node-agent-one'),
      }),
    ).rejects.toThrow(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: target already active`);
  });

  it('admits exactly five concurrent disjoint requests and releases a slot on terminal state', async () => {
    const inputs = Array.from({ length: DOCUMENT_REWRITE_MAX_ACTIVE_REQUESTS + 1 }, (_, index) => ({
      agentId: `agent-capacity-${index}`,
      documentId,
      id: `request-capacity-${index}`,
      instruction: `Rewrite capacity target ${index}`,
      selection: blockSelection(`node-capacity-${index}`),
    }));

    const results = await Promise.allSettled(inputs.map((input) => model.create(input)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(
      DOCUMENT_REWRITE_MAX_ACTIVE_REQUESTS,
    );
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .every(
          (result) =>
            result.reason instanceof Error &&
            result.reason.message === DOCUMENT_REWRITE_ACTIVE_LIMIT,
        ),
    ).toBe(true);

    const firstRequest = inputs[0]!;
    await expect(model.cancel(firstRequest.id, { attempt: 1 })).resolves.toMatchObject({
      request: { status: 'canceled' },
    });
    await expect(
      model.create({
        agentId: 'agent-capacity-released',
        documentId,
        id: 'request-capacity-released',
        instruction: 'Use the released capacity',
        selection: blockSelection('node-capacity-released'),
      }),
    ).resolves.toMatchObject({ isDuplicate: false, request: { status: 'queued' } });
  });

  it('counts concurrent requests across members of one workspace but keeps workspaces isolated', async () => {
    const workspaceAId = 'document-rewrite-capacity-workspace-a';
    const workspaceBId = 'document-rewrite-capacity-workspace-b';
    await serverDB.insert(workspaces).values([
      { id: workspaceAId, name: workspaceAId, primaryOwnerId: userId, slug: workspaceAId },
      { id: workspaceBId, name: workspaceBId, primaryOwnerId: userId, slug: workspaceBId },
    ]);
    await serverDB.insert(workspaceMembers).values({
      role: 'member',
      userId: otherUserId,
      workspaceId: workspaceAId,
    });
    const workspaceDocument = await createDocument(userId, workspaceAId);
    const workspaceModelA = new DocumentRewriteRequestModel(serverDB, userId, workspaceAId);
    const workspaceModelB = new DocumentRewriteRequestModel(serverDB, otherUserId, workspaceAId);
    const otherWorkspaceDocument = await createDocument(userId, workspaceBId);
    const otherWorkspaceModel = new DocumentRewriteRequestModel(
      serverDB,
      otherUserId,
      workspaceBId,
    );

    const sameWorkspaceInputs = Array.from(
      { length: DOCUMENT_REWRITE_MAX_ACTIVE_REQUESTS + 1 },
      (_, index) => ({
        agentId: `workspace-agent-${index}`,
        documentId: workspaceDocument.id,
        id: `workspace-capacity-${index}`,
        instruction: `Workspace rewrite ${index}`,
        selection: blockSelection(`node-workspace-${index}`),
      }),
    );
    const sameWorkspaceResults = await Promise.allSettled(
      sameWorkspaceInputs.map((input, index) =>
        (index % 2 === 0 ? workspaceModelA : workspaceModelB).create(input),
      ),
    );
    expect(sameWorkspaceResults.filter((result) => result.status === 'fulfilled')).toHaveLength(
      DOCUMENT_REWRITE_MAX_ACTIVE_REQUESTS,
    );
    expect(sameWorkspaceResults.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      sameWorkspaceResults
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .every(
          (result) =>
            result.reason instanceof Error &&
            result.reason.message === DOCUMENT_REWRITE_ACTIVE_LIMIT,
        ),
    ).toBe(true);

    // A row in another workspace must not consume this document's slots.
    await expect(
      otherWorkspaceModel.create({
        agentId: 'other-workspace-agent',
        documentId: otherWorkspaceDocument.id,
        id: 'other-workspace-capacity',
        instruction: 'Other workspace rewrite',
        selection: blockSelection('node-other-workspace'),
      }),
    ).resolves.toMatchObject({ isDuplicate: false });

    // Target overlap is document-owned too: another member cannot claim the
    // same block merely because the request row belongs to their user scope.
    await expect(
      workspaceModelB.create({
        agentId: 'workspace-overlap-agent',
        documentId: workspaceDocument.id,
        id: 'workspace-overlap',
        instruction: 'Overlapping workspace rewrite',
        selection: blockSelection('node-workspace-0'),
      }),
    ).rejects.toThrow(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: target already active`);
  });

  it('does not let legacy review rows consume the five-Agent capacity', async () => {
    const legacyReview = await model.create({
      agentId: 'agent-legacy-review',
      documentId,
      id: 'request-legacy-review-capacity',
      instruction: 'Legacy review reservation',
      selection: blockSelection('node-legacy-review-capacity'),
    });
    await model.claim(legacyReview.request.id, { attempt: 1, workerId: 'worker-legacy-review' });
    for (const status of ['syncing', 'thinking', 'writing'] as const) {
      await model.transition(legacyReview.request.id, {
        attempt: 1,
        status,
        workerId: 'worker-legacy-review',
      });
    }
    await model.transition(legacyReview.request.id, {
      attempt: 1,
      lastCommandId: 'legacy-review-command',
      status: 'awaiting_review',
      workerId: 'worker-legacy-review',
    });

    const capacityInputs = Array.from(
      { length: DOCUMENT_REWRITE_MAX_ACTIVE_REQUESTS },
      (_, index) => ({
        agentId: `agent-review-capacity-${index}`,
        documentId,
        id: `request-review-capacity-${index}`,
        instruction: `Capacity beside review ${index}`,
        selection: blockSelection(`node-review-capacity-${index}`),
      }),
    );
    await expect(
      Promise.all(capacityInputs.map((input) => model.create(input))),
    ).resolves.toHaveLength(DOCUMENT_REWRITE_MAX_ACTIVE_REQUESTS);
  });

  it('conservatively reserves the whole document for an unprojected range', async () => {
    const legacyRange = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Legacy multi-block range without projection',
      selection: blockSelection('node-legacy-start', 'node-legacy-end'),
    });
    expect(legacyRange.request.targetNodeIds).toEqual([DOCUMENT_REWRITE_WHOLE_DOCUMENT_TARGET]);
    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Single block inside legacy range',
        selection: blockSelection('node-legacy-middle'),
      }),
    ).rejects.toThrow(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: target already active`);
  });

  it('claims exactly once, renews the lease, and rejects a competing worker', async () => {
    const created = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Rewrite',
      selection: relativeSelection(),
    });
    await expect(
      model.transition(created.request.id, { attempt: 1, status: 'connecting' }),
    ).rejects.toThrow(DOCUMENT_REWRITE_REQUEST_NOT_CLAIMED);

    const claimed = await model.claim(created.request.id, {
      attempt: 1,
      leaseMs: 10_000,
      workerId: 'worker-a',
    });
    expect(claimed).toMatchObject({ status: 'connecting', claimOwner: 'worker-a', attempt: 1 });
    const versionAfterClaim = claimed!.version;

    const duplicateClaim = await model.claim(created.request.id, {
      attempt: 1,
      leaseMs: 10_000,
      workerId: 'worker-a',
    });
    expect(duplicateClaim?.version).toBe(versionAfterClaim);

    expect(
      await model.claim(created.request.id, {
        attempt: 1,
        workerId: 'worker-b',
      }),
    ).toBeUndefined();
    await expect(
      model.transition(created.request.id, {
        attempt: 1,
        status: 'syncing',
        workerId: 'worker-b',
      }),
    ).rejects.toThrow(DOCUMENT_REWRITE_REQUEST_CONFLICT);
    expect(
      await model.renewLease(created.request.id, {
        attempt: 1,
        leaseMs: 10_000,
        workerId: 'worker-a',
      }),
    ).toMatchObject({ claimOwner: 'worker-a', status: 'connecting' });
  });

  it('requires the claimed worker and attempt for a transition sequence', async () => {
    const created = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Rewrite',
      selection: relativeSelection(),
    });
    await model.claim(created.request.id, { attempt: 1, workerId: 'worker-a' });

    for (const status of ['syncing', 'thinking', 'writing', 'awaiting_review'] as const) {
      const result = await model.transition(created.request.id, {
        attempt: 1,
        ...(status === 'awaiting_review' ? { lastCommandId: 'command-1' } : {}),
        status,
        workerId: 'worker-a',
      });
      expect(result?.request.status).toBe(status);
    }

    await expect(
      model.transition(created.request.id, {
        attempt: 1,
        status: 'queued',
        workerId: 'worker-a',
      }),
    ).rejects.toThrow();

    // Review settlement is intentionally worker-independent: the browser's
    // Accept/Reject command updates the request after the agent has left.
    const applied = await model.transition(created.request.id, {
      attempt: 1,
      lastCommandId: 'command-1',
      status: 'applied',
    });
    expect(applied?.request).toMatchObject({ lastCommandId: 'command-1', status: 'applied' });

    const duplicate = await model.transition(created.request.id, {
      attempt: 1,
      status: 'applied',
    });
    expect(duplicate).toMatchObject({ isDuplicate: true, request: { status: 'applied' } });
  });

  it('rejects a transition from an expired worker lease', async () => {
    const created = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Expired lease',
      selection: relativeSelection(),
    });
    await model.claim(created.request.id, { attempt: 1, workerId: 'worker-a' });
    await serverDB
      .update(documentRewriteRequests)
      .set({ leaseExpiresAt: new Date(Date.now() - 1) })
      .where(eq(documentRewriteRequests.id, created.request.id));

    await expect(
      model.transition(created.request.id, {
        attempt: 1,
        status: 'syncing',
        workerId: 'worker-a',
      }),
    ).rejects.toThrow(DOCUMENT_REWRITE_REQUEST_CONFLICT);
  });

  it('lists active rows with expired leases for process-restart recovery', async () => {
    const created = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Recover after process restart',
      selection: relativeSelection(),
    });
    await model.claim(created.request.id, { attempt: 1, workerId: 'dead-worker' });
    await serverDB
      .update(documentRewriteRequests)
      .set({ leaseExpiresAt: new Date(Date.now() - 1) })
      .where(eq(documentRewriteRequests.id, created.request.id));

    expect((await model.listRunnable()).map((request) => request.id)).toContain(created.request.id);
  });

  it('cancels queued requests immediately and active requests cooperatively', async () => {
    const queued = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Queued rewrite',
      selection: relativeSelection(),
    });
    const canceled = await model.cancel(queued.request.id, { attempt: 1 });
    expect(canceled?.request).toMatchObject({ status: 'canceled', attempt: 1 });
    expect((await model.cancel(queued.request.id))?.isDuplicate).toBe(true);

    const active = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Active rewrite',
      selection: relativeSelection(),
    });
    await model.claim(active.request.id, { attempt: 1, workerId: 'worker-a' });
    await model.transition(active.request.id, {
      attempt: 1,
      status: 'syncing',
      workerId: 'worker-a',
    });
    await model.transition(active.request.id, {
      attempt: 1,
      status: 'thinking',
      workerId: 'worker-a',
    });
    expect((await model.cancel(active.request.id, { attempt: 1 }))?.request.status).toBe(
      'cancel_requested',
    );
    expect(
      (
        await model.transition(active.request.id, {
          attempt: 1,
          status: 'canceled',
          workerId: 'worker-a',
        })
      )?.request.status,
    ).toBe('canceled');
  });

  it('settles a cancel_requested row after a worker lease is lost', async () => {
    const created = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Lease loss cancellation',
      selection: relativeSelection(),
    });
    await model.claim(created.request.id, { attempt: 1, workerId: 'worker-a' });
    await model.cancel(created.request.id, { attempt: 1 });
    await serverDB
      .update(documentRewriteRequests)
      .set({ leaseExpiresAt: new Date(Date.now() - 1) })
      .where(
        and(
          eq(documentRewriteRequests.id, created.request.id),
          eq(documentRewriteRequests.attempt, 1),
        ),
      );

    expect(
      await model.claim(created.request.id, { attempt: 1, workerId: 'worker-b' }),
    ).toBeUndefined();
    expect((await model.findById(created.request.id))?.status).toBe('canceled');
  });

  it('increments attempts on retry and makes only the new attempt runnable', async () => {
    const created = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Retry me',
      model: 'retry-model',
      provider: 'retry-provider',
      selection: relativeSelection(),
    });
    await model.claim(created.request.id, { attempt: 1, workerId: 'worker-a' });
    await model.transition(created.request.id, {
      attempt: 1,
      errorCode: 'MODEL_TIMEOUT',
      errorMessage: 'temporary failure',
      status: 'failed',
      workerId: 'worker-a',
    });

    const retried = await model.retry(created.request.id, { attempt: 1 });
    expect(retried?.request).toMatchObject({
      attempt: 2,
      errorCode: null,
      model: null,
      provider: null,
      requestedModel: 'retry-model',
      requestedProvider: 'retry-provider',
      status: 'retry_wait',
    });
    expect(
      (await model.claim(created.request.id, { attempt: 1, workerId: 'worker-b' })) ?? null,
    ).toBe(null);
    const promoted = await model.promoteRetry(created.request.id, 2);
    expect(promoted?.status).toBe('queued');
    expect(
      (await model.claim(created.request.id, { attempt: 2, workerId: 'worker-b' }))?.status,
    ).toBe('connecting');
    expect((await model.findById(created.request.id))?.requestedModel).toBe('retry-model');
    expect((await model.findById(created.request.id))?.requestedProvider).toBe('retry-provider');
  });

  it('atomically retries a live worker without releasing its target reservation', async () => {
    const created = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Retry atomically',
      model: 'atomic-model',
      provider: 'atomic-provider',
      selection: blockSelection('node-atomic-retry'),
    });
    await model.claim(created.request.id, { attempt: 1, workerId: 'worker-a' });
    await model.transition(created.request.id, {
      attempt: 1,
      status: 'syncing',
      workerId: 'worker-a',
    });
    await model.transition(created.request.id, {
      attempt: 1,
      status: 'thinking',
      workerId: 'worker-a',
    });

    const retried = await model.retryWorker(created.request.id, {
      attempt: 1,
      delayMs: 500,
      errorCode: 'MODEL_TIMEOUT',
      errorMessage: 'upstream timed out',
      workerId: 'worker-a',
    });
    expect(retried?.request).toMatchObject({
      attempt: 2,
      errorCode: 'MODEL_TIMEOUT',
      model: null,
      provider: null,
      requestedModel: 'atomic-model',
      requestedProvider: 'atomic-provider',
      status: 'retry_wait',
      targetKey: 'node-atomic-retry',
    });

    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Competing retry target',
        selection: blockSelection('node-atomic-retry'),
      }),
    ).rejects.toThrow(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: target already active`);
  });

  it('does not retry a canceled-after-write request before its pending diff is settled', async () => {
    const created = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Cancel after writing',
      selection: relativeSelection(),
    });
    await model.claim(created.request.id, { attempt: 1, workerId: 'worker-a' });
    await model.transition(created.request.id, {
      attempt: 1,
      status: 'syncing',
      workerId: 'worker-a',
    });
    await model.transition(created.request.id, {
      attempt: 1,
      status: 'thinking',
      workerId: 'worker-a',
    });
    await model.transition(created.request.id, {
      attempt: 1,
      status: 'writing',
      workerId: 'worker-a',
    });
    await model.transition(created.request.id, {
      attempt: 1,
      lastCommandId: 'command-cancel-after-write',
      status: 'canceled_after_write',
      workerId: 'worker-a',
    });
    await expect(model.retry(created.request.id, { attempt: 1 })).rejects.toThrow(
      DOCUMENT_REWRITE_REQUEST_CONFLICT,
    );
    expect(
      (
        await model.settleReview(created.request.id, {
          attempt: 1,
          expectedCommandId: 'command-cancel-after-write',
          status: 'rejected',
        })
      )?.request,
    ).toMatchObject({ status: 'rejected' });
  });

  it('requires and compares the worker command id without letting review overwrite it', async () => {
    const created = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Review command binding',
      selection: relativeSelection(),
    });
    await model.claim(created.request.id, { attempt: 1, workerId: 'worker-a' });
    await model.transition(created.request.id, {
      attempt: 1,
      status: 'syncing',
      workerId: 'worker-a',
    });
    await model.transition(created.request.id, {
      attempt: 1,
      status: 'thinking',
      workerId: 'worker-a',
    });
    await model.transition(created.request.id, {
      attempt: 1,
      status: 'writing',
      workerId: 'worker-a',
    });
    await expect(
      model.transition(created.request.id, {
        attempt: 1,
        status: 'awaiting_review',
        workerId: 'worker-a',
      }),
    ).rejects.toThrow('lastCommandId required');
    await model.transition(created.request.id, {
      attempt: 1,
      errorCode: 'OLD_REWRITE_ERROR',
      errorMessage: 'an old transient error should not survive a successful review',
      lastCommandId: 'worker-command',
      status: 'awaiting_review',
      workerId: 'worker-a',
    });

    await expect(
      model.settleReview(created.request.id, {
        attempt: 1,
        expectedCommandId: 'forged-command',
        status: 'applied',
      }),
    ).rejects.toThrow(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: command mismatch`);
    const applied = await model.settleReview(created.request.id, {
      attempt: 1,
      expectedCommandId: 'worker-command',
      status: 'applied',
    });
    expect(applied?.request).toMatchObject({
      errorCode: null,
      errorMessage: null,
      lastCommandId: 'worker-command',
      status: 'applied',
    });
  });

  it('sweeps an orphaned review after recovery grace and releases its target', async () => {
    const created = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Review recovery',
      selection: blockSelection('node-review-recovery'),
    });
    await model.claim(created.request.id, { attempt: 1, workerId: 'worker-a' });
    for (const status of ['syncing', 'thinking', 'writing'] as const) {
      await model.transition(created.request.id, {
        attempt: 1,
        status,
        workerId: 'worker-a',
      });
    }
    await model.transition(created.request.id, {
      attempt: 1,
      lastCommandId: 'review-recovery-command',
      status: 'awaiting_review',
      workerId: 'worker-a',
    });
    await serverDB
      .update(documentRewriteRequests)
      .set({ expiresAt: null, updatedAt: new Date(0) })
      .where(eq(documentRewriteRequests.id, created.request.id));

    await expect(model.sweepPendingReviews({ maxAgeMs: 1, now: new Date() })).resolves.toBe(1);
    const [swept] = await serverDB
      .select({
        errorCode: documentRewriteRequests.errorCode,
        status: documentRewriteRequests.status,
      })
      .from(documentRewriteRequests)
      .where(eq(documentRewriteRequests.id, created.request.id));
    expect(swept).toEqual({ errorCode: 'REVIEW_RECOVERY_TIMEOUT', status: 'stale' });

    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Reuse released target',
        selection: blockSelection('node-review-recovery'),
      }),
    ).resolves.toMatchObject({ isDuplicate: false });
  });

  it('requires a persisted room state vector before settling a review', async () => {
    const created = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Review proof',
      selection: relativeSelection(),
    });
    await model.claim(created.request.id, { attempt: 1, workerId: 'worker-proof' });
    for (const status of ['syncing', 'thinking', 'writing'] as const) {
      await model.transition(created.request.id, {
        attempt: 1,
        status,
        workerId: 'worker-proof',
      });
    }
    await model.transition(created.request.id, {
      attempt: 1,
      lastCommandId: 'proof-command',
      status: 'awaiting_review',
      workerId: 'worker-proof',
    });
    const currentDocument = await new DocumentModel(serverDB, userId).findById(documentId);
    if (!currentDocument) throw new Error('Missing test document');
    await serverDB.insert(documentCollaborationStates).values({
      documentId,
      documentUpdatedAt: currentDocument.updatedAt,
      roomId: documentId,
      stateVector: 'proof-state-vector',
      userId,
      versionToken: 'proof-version',
    });
    await serverDB.insert(documentHistories).values({
      documentId,
      editorData: { root: { children: [] } },
      requestId: created.request.id,
      saveSource: 'llm_call',
      savedAt: new Date(),
      source: 'agent_collaboration',
      userId,
    });
    await serverDB
      .update(documents)
      .set({
        editorData: {
          root: {
            children: [
              {
                $: {
                  properties: {
                    rewriteAttempt: 1,
                    rewriteCommandId: 'proof-command',
                    rewriteRequestId: created.request.id,
                  },
                },
                type: 'diff',
              },
            ],
          },
        },
      })
      .where(eq(documents.id, documentId));

    await expect(
      model.settleReview(created.request.id, {
        attempt: 1,
        expectedCommandId: 'proof-command',
        proof: { stateVector: 'wrong-state-vector' },
        status: 'applied',
      }),
    ).rejects.toThrow('DOCUMENT_REWRITE_REVIEW_PROOF_INVALID');
    await expect(
      model.settleReview(created.request.id, {
        attempt: 1,
        expectedCommandId: 'proof-command',
        proof: { stateVector: 'proof-state-vector' },
        status: 'applied',
      }),
    ).rejects.toThrow('Diff is still pending');
    await serverDB
      .update(documents)
      .set({ editorData: { root: { children: [] } } })
      .where(eq(documents.id, documentId));
    await expect(
      model.settleReview(created.request.id, {
        attempt: 1,
        expectedCommandId: 'proof-command',
        proof: { stateVector: 'proof-state-vector' },
        status: 'applied',
      }),
    ).resolves.toMatchObject({ request: { status: 'applied' } });
  });

  it('settles a direct rewrite only after request-linked room persistence', async () => {
    const created = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Apply directly',
      selection: relativeSelection(),
    });
    await model.claim(created.request.id, { attempt: 1, workerId: 'worker-direct' });
    for (const status of ['syncing', 'thinking'] as const) {
      await model.transition(created.request.id, {
        attempt: 1,
        status,
        workerId: 'worker-direct',
      });
    }
    await model.transition(created.request.id, {
      attempt: 1,
      generationId: 'generation-direct-command',
      lastCommandId: 'direct-command',
      status: 'writing',
      workerId: 'worker-direct',
    });

    await expect(
      model.markDirectApplied(created.request.id, {
        attempt: 1,
        commandId: 'direct-command',
        stateVector: 'room-vector-before-persistence',
        workerId: 'worker-direct',
      }),
    ).resolves.toBeUndefined();
    expect((await model.findById(created.request.id))?.status).toBe('writing');

    const currentDocument = await new DocumentModel(serverDB, userId).findById(documentId);
    if (!currentDocument) throw new Error('Missing test document');
    await serverDB.insert(documentCollaborationStates).values({
      documentId,
      documentUpdatedAt: currentDocument.updatedAt,
      roomId: documentId,
      stateVector: 'room-vector-after-persistence',
      userId,
      versionToken: 'direct-version',
    });
    await serverDB.insert(documentHistories).values({
      documentId,
      editorData: { root: { children: [] } },
      requestId: created.request.id,
      saveSource: 'llm_call',
      savedAt: new Date(),
      source: 'agent_collaboration',
      userId,
    });

    await expect(
      model.markDirectApplied(created.request.id, {
        attempt: 1,
        commandId: 'direct-command',
        generationId: 'generation-direct-command',
        outputText: '',
        stateVector: 'room-vector-after-persistence',
        workerId: 'worker-direct',
      }),
    ).resolves.toMatchObject({ request: { status: 'applied' } });
    expect((await model.findById(created.request.id))?.lastCommandId).toBe('direct-command');
  });

  it('clears a retry error when a later attempt is directly applied', async () => {
    const created = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Recover after a provider error',
      selection: relativeSelection(),
    });
    await model.claim(created.request.id, { attempt: 1, workerId: 'worker-retry' });
    await model.transition(created.request.id, {
      attempt: 1,
      status: 'syncing',
      workerId: 'worker-retry',
    });
    await model.transition(created.request.id, {
      attempt: 1,
      status: 'thinking',
      workerId: 'worker-retry',
    });

    const retried = await model.retryWorker(created.request.id, {
      attempt: 1,
      delayMs: 0,
      errorCode: 'DOCUMENT_REWRITE_PRODUCTION_MODEL_ERROR',
      errorMessage: 'The provider failed before the first attempt completed.',
      workerId: 'worker-retry',
    });
    expect(retried?.request).toMatchObject({
      attempt: 2,
      errorCode: 'DOCUMENT_REWRITE_PRODUCTION_MODEL_ERROR',
      status: 'retry_wait',
    });

    await model.promoteRetry(created.request.id, 2);
    await model.claim(created.request.id, { attempt: 2, workerId: 'worker-retry-2' });
    await model.transition(created.request.id, {
      attempt: 2,
      status: 'syncing',
      workerId: 'worker-retry-2',
    });
    await model.transition(created.request.id, {
      attempt: 2,
      status: 'thinking',
      workerId: 'worker-retry-2',
    });
    await model.transition(created.request.id, {
      attempt: 2,
      generationId: 'generation-direct-retry-command',
      lastCommandId: 'direct-retry-command',
      status: 'writing',
      workerId: 'worker-retry-2',
    });
    await persistDirectRewriteEvidence(created.request.id, 'retry-room-vector');

    const applied = await model.markDirectApplied(created.request.id, {
      attempt: 2,
      commandId: 'direct-retry-command',
      generationId: 'generation-direct-retry-command',
      outputText: '',
      stateVector: 'retry-room-vector',
      workerId: 'worker-retry-2',
    });
    expect(applied?.request).toMatchObject({
      attempt: 2,
      errorCode: null,
      errorMessage: null,
      status: 'applied',
    });
  });

  it('retains the cancel-after-write warning when settling a direct command', async () => {
    const created = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Keep the cancel-after-write audit state',
      selection: relativeSelection(),
    });
    await model.claim(created.request.id, { attempt: 1, workerId: 'worker-cancel' });
    await model.transition(created.request.id, {
      attempt: 1,
      status: 'syncing',
      workerId: 'worker-cancel',
    });
    await model.transition(created.request.id, {
      attempt: 1,
      status: 'thinking',
      workerId: 'worker-cancel',
    });
    await model.transition(created.request.id, {
      attempt: 1,
      generationId: 'generation-cancel-after-write-command',
      lastCommandId: 'cancel-after-write-command',
      status: 'writing',
      workerId: 'worker-cancel',
    });
    expect((await model.cancel(created.request.id, { attempt: 1 }))?.request.status).toBe(
      'cancel_requested',
    );
    await persistDirectRewriteEvidence(created.request.id, 'cancel-room-vector');

    const applied = await model.markDirectApplied(created.request.id, {
      attempt: 1,
      commandId: 'cancel-after-write-command',
      generationId: 'generation-cancel-after-write-command',
      outputText: '',
      stateVector: 'cancel-room-vector',
      workerId: 'worker-cancel',
    });
    expect(applied?.request).toMatchObject({
      errorCode: 'CANCELED_AFTER_WRITE',
      errorMessage: 'Cancellation arrived after the direct rewrite was written',
      status: 'applied',
    });
  });

  it('keeps personal requests out of another user scope and strips unknown selection secrets', async () => {
    const selection = {
      ...relativeSelection(),
      ticket: 'must-not-persist',
    } as DocumentRewriteSelection & {
      ticket: string;
    };
    const created = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Secure rewrite',
      selection,
    });
    expect(created.request.selection).not.toHaveProperty('ticket');

    const otherModel = new DocumentRewriteRequestModel(serverDB, otherUserId);
    expect(await otherModel.findById(created.request.id)).toBeUndefined();
  });

  it('rejects a client-supplied applied text proof', async () => {
    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Forge the apply proof',
        selection: {
          ...relativeSelection(),
          appliedTextHash: hashRewriteText('forged'),
        } as DocumentRewriteSelection,
      }),
    ).rejects.toThrow('selection.appliedTextHash');
  });

  it('rejects malformed or oversized selection anchors before persistence', async () => {
    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Bad anchor',
        selection: {
          ...relativeSelection(),
          anchorPos: [],
        } as unknown as DocumentRewriteSelection,
      }),
    ).rejects.toThrow('selection.relativePositions');

    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Bad relative position',
        selection: {
          ...relativeSelection(),
          anchorPos: { item: { client: 'not-a-number', clock: 1 } },
        } as unknown as DocumentRewriteSelection,
      }),
    ).rejects.toThrow('selection.anchorPos.item');

    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Bad timestamp',
        selection: {
          ...relativeSelection(),
          capturedAt: 'not-a-date',
        } as unknown as DocumentRewriteSelection,
      }),
    ).rejects.toThrow('selection.capturedAt');

    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Large anchor',
        selection: {
          ...relativeSelection(),
          anchorPos: { value: 'x'.repeat(140_000) },
        } as unknown as DocumentRewriteSelection,
      }),
    ).rejects.toThrow('selection.bytes');

    let deeplyNested: Record<string, unknown> = { value: 'x' };
    for (let index = 0; index < 20; index++) deeplyNested = { next: deeplyNested };
    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Deeply nested anchor',
        selection: {
          ...relativeSelection(),
          anchorPos: deeplyNested,
        } as unknown as DocumentRewriteSelection,
      }),
    ).rejects.toThrow('selection.depth');

    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Bad offset',
        selection: {
          ...blockSelection(),
          endOffset: 1.5,
        } as unknown as DocumentRewriteSelection,
      }),
    ).rejects.toThrow('selection.offsets');

    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Bad relative target projection',
        selection: {
          ...relativeSelection(),
          startNodeId: 42,
        } as unknown as DocumentRewriteSelection,
      }),
    ).rejects.toThrow('selection.startNodeId');

    await expect(
      model.create({
        agentId: 'agent-rewrite',
        documentId,
        instruction: 'Bad relative target offset',
        selection: {
          ...relativeSelection(),
          startOffset: Number.MAX_SAFE_INTEGER,
        } as unknown as DocumentRewriteSelection,
      }),
    ).rejects.toThrow('selection.startOffset');
  });

  it('rejects expired requests before a worker can claim or transition them', async () => {
    const created = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      expiresAt: new Date(Date.now() - 1_000),
      instruction: 'Expired rewrite',
      selection: relativeSelection(),
    });
    expect(
      await model.claim(created.request.id, { attempt: 1, workerId: 'worker-a' }),
    ).toBeUndefined();
    expect((await model.findById(created.request.id))?.status).toBe('stale');
  });

  it('deletes every terminal turn in a session without touching document history', async () => {
    const sessionId = 'delete-session-terminal';
    const first = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Delete terminal turn one',
      selection: blockSelection('delete-node-one'),
      sessionId,
      turnIndex: 1,
    });
    const second = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Delete terminal turn two',
      selection: blockSelection('delete-node-two'),
      sessionId,
      turnIndex: 2,
    });
    await serverDB
      .update(documentRewriteRequests)
      .set({ status: 'applied' })
      .where(inArray(documentRewriteRequests.id, [first.request.id, second.request.id]));

    const deleted = await model.deleteSession({ documentId, sessionId });
    expect(deleted).toMatchObject({
      deletedCount: 2,
      documentId,
      requestId: first.request.id,
      sessionId,
    });
    expect(await model.findById(first.request.id)).toBeUndefined();
    expect(await model.findById(second.request.id)).toBeUndefined();
  });

  it('rejects session deletion while any turn is queued or active', async () => {
    const created = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Keep active rewrite record',
      selection: blockSelection('delete-node-active'),
      sessionId: 'delete-session-active',
    });

    await expect(
      model.deleteSession({ documentId, requestId: created.request.id }),
    ).rejects.toThrow(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: session is still active`);
    expect(await model.findById(created.request.id)).toBeDefined();
  });

  it('does not delete a request outside the model user scope', async () => {
    const created = await model.create({
      agentId: 'agent-rewrite',
      documentId,
      instruction: 'Keep scoped rewrite record',
      selection: blockSelection('delete-node-scope'),
      sessionId: 'delete-session-scope',
    });
    await serverDB
      .update(documentRewriteRequests)
      .set({ status: 'failed' })
      .where(eq(documentRewriteRequests.id, created.request.id));

    const otherModel = new DocumentRewriteRequestModel(serverDB, otherUserId);
    expect(
      await otherModel.deleteSession({ documentId, requestId: created.request.id }),
    ).toBeUndefined();
    expect(await model.findById(created.request.id)).toBeDefined();
  });
});
