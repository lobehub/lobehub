// @vitest-environment node
import {
  APPLY_BLOCK_REWRITE_COMMAND,
  hashRewriteText,
  LITEXML_REWRITE_RANGE_COMMAND,
  type RewriteCommandResult,
} from '@lobehub/editor/headless';
import { describe, expect, it, vi } from 'vitest';

import type { DocumentRewriteDirectApplyInput } from '@/database/models/documentRewriteRequest';
import type {
  DocumentRewriteRequestItem,
  DocumentRewriteSelection,
} from '@/database/schemas/documentRewriteRequest';

import {
  createProductionRewriteGenerator,
  DOCUMENT_REWRITE_MOCK_MODEL,
  DOCUMENT_REWRITE_MOCK_PROVIDER,
  DOCUMENT_REWRITE_MOCK_REPLACEMENT_TEXT_ENV,
  DOCUMENT_REWRITE_PRODUCTION_CONFIG_ERROR,
} from './productionGenerator';
import {
  type CollaborativeAgentEditorFactory,
  type CollaborativeAgentEditorSession,
  DOCUMENT_REWRITE_MAX_GENERATED_OUTPUT_BYTES,
  DOCUMENT_REWRITE_WORKER_NOT_CONFIGURED,
  DOCUMENT_REWRITE_WORKER_STREAM_SESSION_BUSY,
  DOCUMENT_REWRITE_WORKER_SYNC_TIMEOUT,
  DOCUMENT_REWRITE_WORKER_TOPIC_REQUIRED,
  documentRewriteEditorFactory,
  type DocumentRewriteRequestLifecycle,
  DocumentRewriteWorker,
  resolveDocumentRewriteCollaborationWsUrl,
  type RewriteGeneratorChunkHandler,
  type RewriteGeneratorInput,
  segmentRewriteGraphemes,
} from './worker';

afterEach(() => {
  vi.unstubAllEnvs();
});

const makeSelection = (quotedText = 'Original text'): DocumentRewriteSelection => ({
  anchorPos: { assoc: 0, tname: 'root' },
  baseStateVector: 'state-vector',
  capturedAt: '2026-08-29T00:00:00.000Z',
  focusPos: { assoc: 0, tname: 'root' },
  kind: 'relative',
  quotedText,
  quotedTextHash: hashRewriteText(quotedText),
  roomId: 'room-1',
  startNodeId: 'node-start',
  targetNodeIds: ['node-start'],
});

const makeNodeSelection = (
  nodeId = 'node-start',
  adapterId = 'artifact',
  source = '<main>Artifact</main>',
): DocumentRewriteSelection => ({
  adapterId,
  endNodeId: nodeId,
  endOffset: 1,
  kind: 'block',
  quotedText: 'Artifact card',
  quotedTextHash: hashRewriteText('Artifact card'),
  roomId: 'room-1',
  sourceHash: hashRewriteText(source),
  startNodeId: nodeId,
  startOffset: 0,
  targetKind: 'node',
  targetNodeId: nodeId,
  targetNodeIds: [nodeId],
});

const makeRequest = (selection = makeSelection()): DocumentRewriteRequestItem =>
  ({
    agentId: 'agent-1',
    attempt: 1,
    cancelRequestedAt: null,
    claimOwner: null,
    claimedAt: null,
    createdAt: new Date(0),
    documentId: 'document-1',
    errorCode: null,
    errorMessage: null,
    expiresAt: new Date(Date.now() + 60_000),
    generationId: null,
    id: 'request-1',
    instruction: 'Make this concise',
    lastCommandId: null,
    leaseExpiresAt: null,
    model: null,
    outputText: null,
    nextAttemptAt: null,
    operationId: null,
    provider: null,
    requestedByUserId: 'user-1',
    selection,
    sessionId: 'rws_session-1',
    status: 'queued',
    targetKey: 'node-start',
    targetNodeIds: ['node-start'],
    terminalAt: null,
    topicId: 'topic-1',
    turnIndex: 1,
    toolCallId: null,
    updatedAt: new Date(0),
    version: 1,
    workspaceId: null,
    quotedText: selection.quotedText,
  }) as DocumentRewriteRequestItem;

class FakeLifecycle implements DocumentRewriteRequestLifecycle {
  request: DocumentRewriteRequestItem;
  transitions: Array<Record<string, unknown>> = [];
  progressUpdates: Array<Record<string, unknown>> = [];
  ticketInputs: Array<Record<string, unknown>> = [];
  listRunnable?: DocumentRewriteRequestLifecycle['listRunnable'];
  sweepPendingReviews?: DocumentRewriteRequestLifecycle['sweepPendingReviews'];
  constructor(request = makeRequest()) {
    this.request = request;
  }
  findById = async () => this.request;
  claim = async (_id: string, input: { attempt: number; workerId: string }) => {
    if (this.request.attempt !== input.attempt || this.request.status !== 'queued')
      return undefined;
    this.request = {
      ...this.request,
      claimOwner: input.workerId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      status: 'connecting',
    };
    return this.request;
  };
  renewLease: DocumentRewriteRequestLifecycle['renewLease'] = async () => this.request;
  updateProgress: NonNullable<DocumentRewriteRequestLifecycle['updateProgress']> = async (
    _id,
    input,
  ) => {
    this.progressUpdates.push(input as unknown as Record<string, unknown>);
    this.request = { ...this.request, progress: input.progress };
    return this.request;
  };
  issueRoomTicket = async (_id: string, input: Record<string, unknown>) => {
    this.ticketInputs.push(input);
    return 'ticket-1';
  };
  retryWorker: DocumentRewriteRequestLifecycle['retryWorker'] = async (_id, input) => {
    this.request = {
      ...this.request,
      attempt: input.attempt + 1,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      status: 'retry_wait',
    };
    return { isDuplicate: false, request: this.request };
  };
  transitionWorker = async (_id: string, input: Record<string, unknown>) => {
    this.transitions.push(input);
    this.request = { ...this.request, ...(input as Partial<DocumentRewriteRequestItem>) };
    return { isDuplicate: false, request: this.request };
  };
  markDirectApplied: NonNullable<DocumentRewriteRequestLifecycle['markDirectApplied']> = async (
    _id: string,
    input: DocumentRewriteDirectApplyInput,
  ) => {
    if (this.request.status === 'applied') return { isDuplicate: true, request: this.request };
    if (
      this.request.status !== 'writing' &&
      this.request.status !== 'connecting' &&
      this.request.status !== 'cancel_requested'
    ) {
      return undefined;
    }
    this.request = {
      ...this.request,
      errorCode:
        this.request.status === 'cancel_requested'
          ? 'CANCELED_AFTER_WRITE'
          : this.request.errorCode,
      generationId: input.generationId ?? this.request.generationId,
      lastCommandId: input.commandId,
      model: input.model ?? this.request.model,
      outputText: input.outputText ?? this.request.outputText,
      provider: input.provider ?? this.request.provider,
      status: 'applied',
    };
    this.transitions.push({ ...input, status: 'applied' });
    return { isDuplicate: false, request: this.request };
  };
  promoteRetry = async () => undefined;
}

const createEditor = (overrides: Partial<CollaborativeAgentEditorSession> = {}) => {
  const states: string[] = [];
  const editor: CollaborativeAgentEditorSession = {
    connect: vi.fn(async () => undefined),
    clearAwareness: vi.fn(),
    disconnect: vi.fn(async () => undefined),
    dispatchCommand: vi.fn(
      async () =>
        ({
          affectedNodeIds: ['node-start'],
          commandId: 'command-1',
          requestId: 'request-1',
          status: 'applied' as const,
        }) as unknown as RewriteCommandResult,
    ),
    resolveSelection: vi.fn((selection: DocumentRewriteSelection) => ({
      endNodeId: selection.endNodeId ?? 'node-start',
      quotedText: selection.quotedText,
      selection: {},
      startNodeId: selection.startNodeId ?? 'node-start',
    })) as unknown as CollaborativeAgentEditorSession['resolveSelection'],
    setAgentAwareness: vi.fn((state: unknown) => {
      const awarenessState = state as {
        awarenessData?: { status?: string };
        status?: string;
      };
      const status = awarenessState.awarenessData?.status ?? awarenessState.status;
      if (status) states.push(status);
    }),
    getStateVector: vi.fn(() => 'state-vector'),
    setSelection: vi.fn(() => true),
    waitForSync: vi.fn(async () => undefined),
    ...overrides,
  };
  return { editor, states };
};

const factoryFor = (editor: CollaborativeAgentEditorSession): CollaborativeAgentEditorFactory => ({
  connect: vi.fn(async () => editor),
});

const createStreamingEditor = (
  overrides: Partial<CollaborativeAgentEditorSession> = {},
): {
  append: ReturnType<typeof vi.fn>;
  editor: CollaborativeAgentEditorSession;
  finalize: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
} => {
  const append = vi.fn(async () => undefined);
  const finalize = vi.fn(async () => ({
    affectedNodeIds: ['node-start'],
    commandId: 'stream-command-1',
    requestId: 'request-1',
    status: 'applied' as const,
  }));
  const start = vi.fn(async () => ({ append, finalize }));
  const { editor } = createEditor({
    startStreamingRewrite: start,
    ...overrides,
  });
  return { append, editor, finalize, start };
};

describe('DocumentRewriteWorker', () => {
  it('requires an explicit WebSocket endpoint in production', () => {
    expect(resolveDocumentRewriteCollaborationWsUrl('wss://relay.example///')).toBe(
      'wss://relay.example',
    );

    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PAGE_COLLABORATION_WS_URL', '');
    vi.stubEnv('NEXT_PUBLIC_PAGE_COLLABORATION_URL', '');
    try {
      expect(() => resolveDocumentRewriteCollaborationWsUrl()).toThrow(
        DOCUMENT_REWRITE_WORKER_NOT_CONFIGURED,
      );
      expect(() => resolveDocumentRewriteCollaborationWsUrl('http://relay.example')).toThrow(
        DOCUMENT_REWRITE_WORKER_NOT_CONFIGURED,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('uses the real editor pre-connect factory without exposing a raw provider', async () => {
    const session = await documentRewriteEditorFactory.create!({
      documentId: 'document-preconnect',
      requestId: 'request-preconnect',
      roomId: 'room-preconnect',
      ticket: 'ticket-preconnect',
    });

    expect(session).toMatchObject({
      connect: expect.any(Function),
      dispatchCommand: expect.any(Function),
      resolveSelection: expect.any(Function),
      waitForSync: expect.any(Function),
    });
    await session.disconnect();
  });

  it('runs the direct durable lifecycle and exposes only sanitized generator input', async () => {
    const lifecycle = new FakeLifecycle();
    const { editor, states } = createEditor();
    let generatorInput!: RewriteGeneratorInput;
    const generator = vi.fn(async (input: RewriteGeneratorInput) => {
      generatorInput = input;
      return { model: 'model-1', provider: 'provider-1', replacementText: 'Concise text' };
    });
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator,
      requestService: lifecycle,
      workerId: 'worker-1',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });

    expect(result).toMatchObject({ commandId: 'command-1', status: 'applied' });
    expect(editor.setAgentAwareness).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'thinking',
        sessionId: 'rws_session-1',
        anchorPos: expect.any(Object),
        focusPos: expect.any(Object),
        targetNodeIds: ['node-start'],
      }),
    );
    expect(generator).toHaveBeenCalledTimes(1);
    expect(generatorInput).toMatchObject({
      agentId: 'agent-1',
      attempt: 1,
      endNodeId: 'node-start',
      instruction: 'Make this concise',
      quotedText: 'Original text',
      requestId: 'request-1',
      sessionId: 'rws_session-1',
      startNodeId: 'node-start',
      targetNodeIds: ['node-start'],
      turnIndex: 1,
    });
    expect(generatorInput).not.toHaveProperty('request');
    expect(generatorInput).not.toHaveProperty('selection');
    expect(generatorInput).not.toHaveProperty('nodeKey');
    expect(editor.dispatchCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ attempt: 1, mode: 'direct' }),
    );
    const dispatchPayload = vi.mocked(editor.dispatchCommand).mock.calls[0]?.[1] as {
      selection?: unknown;
    };
    expect(dispatchPayload.selection).toEqual(lifecycle.request.selection);
    expect(dispatchPayload).toMatchObject({
      provenanceSessionId: 'rws_session-1',
      sessionId: 'rws_session-1',
      turnIndex: 1,
    });
    expect(lifecycle.ticketInputs[0]).toMatchObject({
      attempt: 1,
      workerId: 'worker-1',
      roomId: 'room-1',
    });
    expect(lifecycle.transitions.map((transition) => transition.status)).toEqual([
      'syncing',
      'thinking',
      'writing',
      'applied',
    ]);
    expect(states).toEqual(['connecting', 'syncing', 'thinking', 'writing', 'done']);
    expect(editor.disconnect).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe('done');
  });

  it('still publishes a text-range cursor for an ordinary paragraph selected from the block menu', async () => {
    const selection = {
      ...makeSelection(),
      kind: 'block' as const,
      startNodeId: 'node-start',
      endNodeId: 'node-start',
      startOffset: 0,
      endOffset: 13,
    };
    const lifecycle = new FakeLifecycle(makeRequest(selection));
    const { editor } = createEditor();
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: async () => ({ replacementText: 'Concise text' }),
      requestService: lifecycle,
      workerId: 'text-block-worker',
    });
    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      status: 'applied',
    });
    expect(editor.setAgentAwareness).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'thinking',
        focusing: true,
        selectionRange: {
          startNodeId: 'node-start',
          endNodeId: 'node-start',
          startOffset: 0,
          endOffset: 13,
        },
      }),
    );
  });

  it('fails before model execution when a request has no durable topic', async () => {
    const lifecycle = new FakeLifecycle();
    lifecycle.request = { ...lifecycle.request, topicId: null };
    const generator = vi.fn(async () => ({ replacementText: 'must not run' }));
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(createEditor().editor),
      generator,
      requestService: lifecycle,
      workerId: 'worker-topic-required',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      reason: DOCUMENT_REWRITE_WORKER_TOPIC_REQUIRED,
      status: 'failed',
    });
    expect(generator).not.toHaveBeenCalled();
    expect(lifecycle.transitions.at(-1)).toMatchObject({
      errorCode: DOCUMENT_REWRITE_WORKER_TOPIC_REQUIRED,
      status: 'failed',
    });
  });

  it('does not retry a provider credential failure and keeps model/provider diagnostics', async () => {
    const lifecycle = new FakeLifecycle();
    const { editor } = createEditor();
    const generator = vi.fn(async () => {
      throw Object.assign(new Error('Document rewrite provider credentials are unavailable'), {
        code: DOCUMENT_REWRITE_PRODUCTION_CONFIG_ERROR,
        model: 'gemini-3.7-flash',
        provider: 'google',
        retryable: false,
      });
    });
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator,
      maxAttempts: 3,
      requestService: lifecycle,
      workerId: 'worker-provider-config',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      attempt: 1,
      reason: DOCUMENT_REWRITE_PRODUCTION_CONFIG_ERROR,
      status: 'failed',
    });
    expect(generator).toHaveBeenCalledOnce();
    expect(lifecycle.request).toMatchObject({
      attempt: 1,
      errorCode: DOCUMENT_REWRITE_PRODUCTION_CONFIG_ERROR,
      model: 'gemini-3.7-flash',
      provider: 'google',
      status: 'failed',
    });
    expect(lifecycle.transitions.some((transition) => transition.status === 'retry_wait')).toBe(
      false,
    );
  });

  it('waits for a refreshed room sync before re-resolving and applying after generation', async () => {
    const lifecycle = new FakeLifecycle();
    let releaseReconnect!: () => void;
    const reconnectReady = new Promise<void>((resolve) => {
      releaseReconnect = resolve;
    });
    let syncCalls = 0;
    const { editor } = createEditor({
      waitForSync: vi.fn(async () => {
        syncCalls += 1;
        if (syncCalls === 2) await reconnectReady;
      }),
    });
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: async () => ({ replacementText: 'After refreshed sync' }),
      requestService: lifecycle,
      workerId: 'worker-refresh-sync',
    });

    const resultPromise = worker.process({ attempt: 1, requestId: 'request-1' });
    await vi.waitFor(() => expect(syncCalls).toBe(2));
    expect(editor.dispatchCommand).not.toHaveBeenCalled();
    expect(editor.resolveSelection).toHaveBeenCalledOnce();

    releaseReconnect();
    await expect(resultPromise).resolves.toMatchObject({ status: 'applied' });
    expect(editor.resolveSelection).toHaveBeenCalledTimes(2);
    expect(editor.dispatchCommand).toHaveBeenCalledOnce();
  });

  it('persists only ordered, bounded public progress stages', async () => {
    const lifecycle = new FakeLifecycle();
    const { editor } = createEditor();
    const generator = vi.fn(async (input: RewriteGeneratorInput) => {
      await input.onProgress?.({ stage: 'generating_replacement' });
      return { replacementText: 'Progress-aware text' };
    });
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator,
      requestService: lifecycle,
      workerId: 'worker-1',
    });

    await worker.process({ attempt: 1, requestId: 'request-1' });

    const progress = lifecycle.request.progress;
    expect(progress?.events.map((event) => event.stage)).toEqual([
      'syncing',
      'analyzing_context',
      'syncing',
      'generating_replacement',
      'applying',
    ]);
    expect(progress?.events.length).toBeLessThanOrEqual(32);
    expect(JSON.stringify(progress)).not.toContain('thinking_delta');
  });

  it('persists bounded generation diagnostics without source text', async () => {
    const lifecycle = new FakeLifecycle();
    const { editor } = createEditor();
    const generator = vi.fn(async (input: RewriteGeneratorInput) => {
      await input.onDiagnostics?.({
        finishReason: 'length',
        outputLanguage: 'plain',
        outputBytes: 15_893,
        outputCharacters: 15_893,
        outputTextTokens: 16_384,
        requestedMaxTokens: 16_384,
        streamError: false,
        totalOutputTokens: 16_384,
        usagePresent: true,
      });
      return { replacementText: 'Diagnostics-safe text' };
    });
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator,
      requestService: lifecycle,
      workerId: 'worker-diagnostics',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      status: 'applied',
    });
    const details = lifecycle.request.progress?.events
      .map((event) => event.detail)
      .filter((detail): detail is string => Boolean(detail));
    expect(details).toHaveLength(1);
    expect(details?.[0]).toContain('finish_reason=length');
    expect(details?.[0]).toContain('output_chars=15893');
    expect(details?.[0]).toContain('output_bytes=15893');
    expect(details?.[0]).toContain('output_tokens=16384');
    expect(details?.[0]).toContain('total_tokens=16384');
    expect(details?.[0]).toContain('max_tokens=16384');
    expect(details?.[0]).toContain('stream_error=no');
    expect(details?.[0]).toContain('usage_present=yes');
    expect(lifecycle.request.progress?.events.find((event) => event.summary)?.summary).toBe(
      'output_language=plain',
    );
    expect(JSON.stringify(lifecycle.request.progress)).not.toContain('Original text');
  });

  it('resolves and applies an adapter-owned node through the block command', async () => {
    const source = '<main>Artifact</main>';
    const lifecycle = new FakeLifecycle(
      makeRequest(makeNodeSelection('artifact-1', 'artifact', source)),
    );
    const editorStreamingStart = vi.fn();
    const replacement = '<main>Rewritten artifact</main>';
    const target = (currentSource: string) => ({
      adapterId: 'artifact',
      nodeId: 'artifact-1',
      nodeType: 'artifact',
      outputSchema: 'source' as const,
      source: currentSource,
      sourceHash: hashRewriteText(currentSource),
      summary: 'Artifact card',
      title: 'Artifact card',
    });
    const { editor } = createEditor({
      resolveBlockRewriteTarget: vi
        .fn()
        .mockReturnValueOnce(target(source))
        .mockReturnValueOnce(target(source))
        .mockReturnValue(target(replacement)),
      startStreamingRewrite: editorStreamingStart,
    });
    const generatorInput: RewriteGeneratorInput[] = [];
    const generatorStream = vi.fn(
      async (input: RewriteGeneratorInput, onChunk: RewriteGeneratorChunkHandler) => {
        generatorInput.push(input);
        await onChunk({ text: '{"kind":"source","source":"ignored"}' });
        return { replacementBlock: { kind: 'source' as const, source: replacement } };
      },
    );
    const editorFactory = factoryFor(editor);
    const worker = new DocumentRewriteWorker({
      blockRewriteCommand: LITEXML_REWRITE_RANGE_COMMAND,
      editorFactory,
      generator: { generateStream: generatorStream },
      requestService: lifecycle,
      workerId: 'worker-node-target',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      status: 'applied',
    });
    expect(generatorInput[0]).toMatchObject({
      adapterId: 'artifact',
      outputSchema: 'source',
      targetKind: 'node',
      targetNodeId: 'artifact-1',
      targetNodeIds: ['artifact-1'],
    });
    expect(editor.resolveSelection).not.toHaveBeenCalled();
    expect(editor.setAgentAwareness).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'thinking',
        sessionId: 'rws_session-1',
        anchorPos: null,
        focusPos: null,
        caret: null,
        focusing: false,
        targetNodeIds: ['artifact-1'],
      }),
    );
    for (const [state] of vi.mocked(editor.setAgentAwareness!).mock.calls) {
      expect(state).not.toHaveProperty('selectionRange');
    }
    expect(generatorStream).toHaveBeenCalledOnce();
    expect(editorStreamingStart).not.toHaveBeenCalled();
    expect(editorFactory.connect).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: 'room-1' }),
    );
    expect(editor.dispatchCommand).toHaveBeenCalledWith(
      LITEXML_REWRITE_RANGE_COMMAND,
      expect.objectContaining({
        adapterKey: 'artifact',
        expectedSourceHash: hashRewriteText(source),
        nodeId: 'artifact-1',
        output: { kind: 'source', source: replacement },
      }),
    );
    expect(lifecycle.request.outputText).toBe(replacement);
  });

  it('passes the authoritative block-image projection and verifies its materialized patch', async () => {
    type BlockImage = NonNullable<RewriteGeneratorInput['blockImage']>;
    const initialImage: BlockImage = {
      altText: '',
      height: null,
      maxWidth: null,
      placeholder: true,
      src: '',
      status: 'loading' as const,
      width: null,
    };
    const appliedImage = {
      ...initialImage,
      height: 768,
      placeholder: false,
      src: '/f/generated-image',
      status: 'uploaded' as const,
      width: 1024,
    };
    const source = JSON.stringify({
      altText: initialImage.altText,
      height: initialImage.height,
      maxWidth: initialImage.maxWidth,
      placeholder: initialImage.placeholder,
      src: initialImage.src,
      width: initialImage.width,
    });
    const appliedSource = JSON.stringify({
      altText: appliedImage.altText,
      height: appliedImage.height,
      maxWidth: appliedImage.maxWidth,
      placeholder: appliedImage.placeholder,
      src: appliedImage.src,
      width: appliedImage.width,
    });
    const lifecycle = new FakeLifecycle(
      makeRequest({
        ...makeNodeSelection('image-1', 'block-image', source),
        sourceHash: hashRewriteText(source),
      }),
    );
    const target = (image: BlockImage, currentSource: string) => ({
      adapterId: 'block-image',
      image,
      nodeId: 'image-1',
      nodeType: 'block-image',
      outputSchema: 'patch' as const,
      source: currentSource,
      sourceHash: hashRewriteText(currentSource),
      summary: 'Generated image',
      title: 'Generated image',
    });
    const { editor } = createEditor({
      resolveBlockRewriteTarget: vi
        .fn()
        .mockReturnValueOnce(target(initialImage, source))
        .mockReturnValueOnce(target(initialImage, source))
        .mockReturnValueOnce(target(appliedImage, appliedSource)),
    });
    let generatorInput!: RewriteGeneratorInput;
    const generator = vi.fn(async (input: RewriteGeneratorInput) => {
      generatorInput = input;
      return {
        replacementBlock: {
          kind: 'patch' as const,
          patch: { height: 768, src: '/f/generated-image', width: 1024 },
        },
      };
    });
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator,
      requestService: lifecycle,
      workerId: 'worker-block-image',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      status: 'applied',
    });
    expect(generatorInput.blockImage).toEqual(initialImage);
    expect(editor.dispatchCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        adapterKey: 'block-image',
        expectedSourceHash: hashRewriteText(source),
        nodeId: 'image-1',
        output: {
          kind: 'patch',
          patch: { height: 768, src: '/f/generated-image', width: 1024 },
        },
      }),
    );
    expect(lifecycle.request.outputText).toBe(appliedSource);
  });

  it('rejects an unsafe block-image patch before dispatch', async () => {
    const source = JSON.stringify({
      altText: '',
      height: null,
      maxWidth: null,
      placeholder: true,
      src: '',
      width: null,
    });
    const lifecycle = new FakeLifecycle(
      makeRequest({
        ...makeNodeSelection('image-unsafe', 'block-image', source),
        sourceHash: hashRewriteText(source),
      }),
    );
    const { editor } = createEditor({
      resolveBlockRewriteTarget: vi.fn(() => ({
        adapterId: 'block-image',
        image: {
          altText: '',
          height: null,
          maxWidth: null,
          placeholder: true,
          src: '',
          status: 'loading' as const,
          width: null,
        },
        nodeId: 'image-unsafe',
        nodeType: 'block-image',
        outputSchema: 'patch' as const,
        source,
        sourceHash: hashRewriteText(source),
      })),
    });
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: async () => ({
        replacementBlock: { kind: 'patch' as const, patch: { src: 'data:image/png;base64,AAAA' } },
      }),
      requestService: lifecycle,
      workerId: 'worker-block-image-unsafe',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      status: 'failed',
      reason: 'DOCUMENT_REWRITE_WORKER_GENERATOR_INVALID',
    });
    expect(editor.dispatchCommand).not.toHaveBeenCalled();
  });

  it('fails closed and safely retries when an Artifact model returns a fragment for a full HTML document', async () => {
    const source =
      '<!doctype html><html><head><title>Game</title><style>.board{display:grid}</style></head><body><div id="app"></div><script>window.startGame()</script></body></html>';
    const lifecycle = new FakeLifecycle(
      makeRequest(makeNodeSelection('artifact-1', 'artifact', source)),
    );
    const { editor } = createEditor({
      resolveBlockRewriteTarget: vi.fn(() => ({
        adapterId: 'artifact',
        nodeId: 'artifact-1',
        nodeType: 'artifact',
        outputSchema: 'source' as const,
        source,
        sourceHash: hashRewriteText(source),
        summary: 'Game',
        title: 'Game',
      })),
    });
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: async () => ({
        replacementBlock: { kind: 'source' as const, source: '<title>New title</title>' },
      }),
      requestService: lifecycle,
      workerId: 'worker-artifact-completeness',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      status: 'retry_wait',
      reason: 'DOCUMENT_REWRITE_WORKER_GENERATOR_INVALID',
    });
    expect(editor.dispatchCommand).not.toHaveBeenCalled();
    expect(lifecycle.request).toMatchObject({
      attempt: 2,
      errorCode: 'DOCUMENT_REWRITE_WORKER_GENERATOR_INVALID',
      outputText: null,
      status: 'retry_wait',
    });
  });

  it('blocks a false-positive applied result when the post-command source is unchanged', async () => {
    const source = '<main>Artifact</main>';
    const replacement = '<main>Rewritten artifact</main>';
    const lifecycle = new FakeLifecycle(
      makeRequest(makeNodeSelection('artifact-1', 'artifact', source)),
    );
    const { editor } = createEditor({
      resolveBlockRewriteTarget: vi.fn(() => ({
        adapterId: 'artifact',
        nodeId: 'artifact-1',
        nodeType: 'artifact',
        outputSchema: 'source' as const,
        source,
        sourceHash: hashRewriteText(source),
        summary: 'Artifact card',
        title: 'Artifact card',
      })),
    });
    const markDirectApplied = vi.spyOn(lifecycle, 'markDirectApplied');
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: async () => ({
        replacementBlock: { kind: 'source' as const, source: replacement },
      }),
      requestService: lifecycle,
      workerId: 'worker-node-source-proof',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      reason: 'DOCUMENT_REWRITE_WORKER_GENERATION_CONFLICT',
      status: 'stale',
    });
    expect(editor.dispatchCommand).toHaveBeenCalledOnce();
    expect(markDirectApplied).not.toHaveBeenCalled();
    expect(lifecycle.request.status).toBe('stale');
  });

  it('uses the materialized source after applying a patch adapter rewrite', async () => {
    const source = JSON.stringify({ description: 'Old', title: 'Card', url: 'https://old.test' });
    const appliedSource = JSON.stringify({
      description: 'New',
      title: 'Card',
      url: 'https://new.test',
    });
    const lifecycle = new FakeLifecycle(
      makeRequest(makeNodeSelection('link-1', 'link-block-card', source)),
    );
    const target = (currentSource: string, title = 'Game') => ({
      adapterId: 'link-block-card',
      nodeId: 'link-1',
      nodeType: 'link-block-card',
      outputSchema: 'patch' as const,
      source: currentSource,
      sourceHash: hashRewriteText(currentSource),
      summary: 'Card',
      title: 'Card',
    });
    const { editor } = createEditor({
      resolveBlockRewriteTarget: vi
        .fn()
        .mockReturnValueOnce(target(source))
        .mockReturnValueOnce(target(source))
        .mockReturnValue(target(appliedSource)),
    });
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: async () => ({
        replacementBlock: {
          kind: 'patch' as const,
          patch: { description: 'New', url: 'https://new.test' },
        },
      }),
      requestService: lifecycle,
      workerId: 'worker-patch-source-proof',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      status: 'applied',
    });
    expect(lifecycle.request.outputText).toBe(appliedSource);
  });

  it('fails closed when the editor does not provide an adapter output schema', async () => {
    const source = '<main>Artifact</main>';
    const replacement = '<main>Should not run</main>';
    const lifecycle = new FakeLifecycle(
      makeRequest(makeNodeSelection('artifact-1', 'artifact', source)),
    );
    const generator = vi.fn(async () => ({
      replacementBlock: { kind: 'source' as const, source: replacement },
    }));
    const { editor } = createEditor({
      resolveBlockRewriteTarget: vi.fn(() => ({
        adapterId: 'artifact',
        nodeId: 'artifact-1',
        nodeType: 'artifact',
        source,
        sourceHash: hashRewriteText(source),
        summary: 'Artifact card',
        title: 'Artifact card',
      })),
    });
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator,
      requestService: lifecycle,
      workerId: 'worker-unknown-output-schema',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      reason: 'DOCUMENT_REWRITE_WORKER_GENERATION_CONFLICT',
      status: 'stale',
    });
    expect(generator).not.toHaveBeenCalled();
    expect(editor.dispatchCommand).not.toHaveBeenCalled();
  });

  it('blocks an applied result when source changes but the requested language does not', async () => {
    const source = 'const value = 1;';
    const replacement = 'def quick_sort(items):\n    return items';
    const lifecycle = new FakeLifecycle(
      makeRequest(makeNodeSelection('code-1', 'codemirror', source)),
    );
    const target = (currentSource: string) => ({
      adapterId: 'codemirror',
      language: 'javascript',
      languageAliases: ['javascript', 'js'],
      nodeId: 'code-1',
      nodeType: 'code',
      outputSchema: 'source' as const,
      source: currentSource,
      sourceHash: hashRewriteText(currentSource),
      summary: 'Code (javascript)',
      title: 'Code (javascript)',
    });
    const { editor } = createEditor({
      resolveBlockRewriteTarget: vi
        .fn()
        .mockReturnValueOnce(target(source))
        .mockReturnValueOnce(target(source))
        .mockReturnValue(target(replacement)),
    });
    const markDirectApplied = vi.spyOn(lifecycle, 'markDirectApplied');
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: async () => ({
        replacementBlock: {
          kind: 'source' as const,
          language: 'python',
          source: replacement,
        },
      }),
      requestService: lifecycle,
      workerId: 'worker-language-proof',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      reason: 'DOCUMENT_REWRITE_WORKER_GENERATION_CONFLICT',
      status: 'stale',
    });
    expect(markDirectApplied).not.toHaveBeenCalled();
    expect(lifecycle.request.status).toBe('stale');
  });

  it('blocks an applied Artifact result when the derived title was not materialized', async () => {
    const source =
      '<!doctype html><html><head><title>Old</title></head><body><main>Old</main></body></html>';
    const replacement =
      '<!doctype html><html><head><title>New</title></head><body><main>New</main></body></html>';
    const lifecycle = new FakeLifecycle(
      makeRequest(makeNodeSelection('artifact-title-1', 'artifact', source)),
    );
    const target = (currentSource: string) => ({
      adapterId: 'artifact',
      nodeId: 'artifact-title-1',
      nodeType: 'artifact',
      outputSchema: 'source' as const,
      source: currentSource,
      sourceHash: hashRewriteText(currentSource),
      summary: 'Old',
      title: 'Old',
    });
    const { editor } = createEditor({
      resolveBlockRewriteTarget: vi
        .fn()
        .mockReturnValueOnce(target(source))
        .mockReturnValueOnce(target(source))
        .mockReturnValue(target(replacement)),
    });
    const markDirectApplied = vi.spyOn(lifecycle, 'markDirectApplied');
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: async () => ({
        replacementBlock: { kind: 'source' as const, source: replacement },
      }),
      requestService: lifecycle,
      workerId: 'worker-artifact-title-proof',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      reason: 'DOCUMENT_REWRITE_WORKER_GENERATION_CONFLICT',
      status: 'stale',
    });
    expect(markDirectApplied).not.toHaveBeenCalled();
    expect(lifecycle.request.status).toBe('stale');
  });

  it('accepts a complete Artifact document even when the replacement is much shorter', async () => {
    const source =
      '<!doctype html><html><head><title>Game</title><style>.board{display:grid}</style></head><body><div id="app"></div><script>window.startGame()</script></body></html>';
    const replacement =
      '<!doctype html><html><head><title>New game</title><style>.board{display:grid}</style></head><body><div id="app"></div><script>window.startGame()</script></body></html>';
    const lifecycle = new FakeLifecycle(
      makeRequest(makeNodeSelection('artifact-1', 'artifact', source)),
    );
    const target = (currentSource: string, title = 'Game') => ({
      adapterId: 'artifact',
      nodeId: 'artifact-1',
      nodeType: 'artifact',
      outputSchema: 'source' as const,
      source: currentSource,
      sourceHash: hashRewriteText(currentSource),
      summary: 'Game',
      title,
    });
    const { editor } = createEditor({
      resolveBlockRewriteTarget: vi
        .fn()
        .mockReturnValueOnce(target(source))
        .mockReturnValueOnce(target(source))
        .mockReturnValue(target(replacement, 'New game')),
    });
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: async () => ({
        replacementBlock: { kind: 'source' as const, source: replacement },
      }),
      requestService: lifecycle,
      workerId: 'worker-artifact-completeness-valid',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      status: 'applied',
    });
    expect(editor.dispatchCommand).toHaveBeenCalledWith(
      APPLY_BLOCK_REWRITE_COMMAND,
      expect.objectContaining({
        adapterKey: 'artifact',
        output: { kind: 'source', source: replacement },
      }),
    );
    expect(lifecycle.request.outputText).toBe(replacement);
  });

  it('writes provider chunks through one bounded streaming session and finalizes once', async () => {
    const lifecycle = new FakeLifecycle();
    const { append, editor, finalize, start } = createStreamingEditor();
    const generator = {
      generate: vi.fn(async () => ({ replacementText: 'legacy result' })),
      generateStream: vi.fn(async (_input: RewriteGeneratorInput, onChunk) => {
        await onChunk.onStart?.({
          generationId: 'generation-stream-1',
          model: 'model-stream',
          provider: 'provider-stream',
        });
        await onChunk({ chunkId: 'chunk-1', sequence: 1, text: 'Con' });
        await onChunk({ chunkId: 'chunk-2', sequence: 2, text: 'cise' });
        await onChunk({ chunkId: 'chunk-3', sequence: 3, text: ' text' });
        return {
          generationId: 'generation-stream-1',
          model: 'model-stream',
          provider: 'provider-stream',
          replacementText: 'Concise text',
        };
      }),
    };
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator,
      requestService: lifecycle,
      streamingFlushMs: 30,
      workerId: 'worker-1',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });

    expect(result).toMatchObject({ commandId: 'stream-command-1', status: 'applied' });
    expect(generator.generate).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: 'generation-stream-1',
        requestId: 'request-1',
        sessionId: 'request-1:attempt:1',
      }),
    );
    expect(append.mock.calls.length).toBeGreaterThan(1);
    expect(append.mock.calls.map(([chunk]) => chunk.text).join('')).toBe('Concise text');
    expect(append.mock.calls.every(([chunk]) => (chunk.text as string).length > 0)).toBe(true);
    expect(finalize).toHaveBeenCalledOnce();
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({ replacementText: 'Concise text', requestId: 'request-1' }),
    );
    expect(lifecycle.transitions.map((transition) => transition.status)).toEqual([
      'syncing',
      'thinking',
      'writing',
      'applied',
    ]);
  });

  it('fails closed when streaming final metadata contains chunks never accepted by the room', async () => {
    const lifecycle = new FakeLifecycle();
    const { append, editor, finalize } = createStreamingEditor();
    editor.startStreamingRewrite = vi.fn(async () => ({ append, finalize }));
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: {
        generateStream: vi.fn(async (_input: RewriteGeneratorInput, onChunk) => {
          await onChunk({ chunkId: 'partial-only', sequence: 1, text: 'partial' });
          return { replacementText: 'partial plus missing chunk' };
        }),
      },
      requestService: lifecycle,
      workerId: 'worker-stream-final-proof',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });

    expect(result).toMatchObject({
      reason: 'DOCUMENT_REWRITE_WORKER_GENERATION_CONFLICT',
      status: 'stale',
    });
    expect(finalize).not.toHaveBeenCalled();
    expect(lifecycle.request.status).toBe('stale');
  });

  it('fails a stream when the generator throws after an accepted partial chunk', async () => {
    const lifecycle = new FakeLifecycle();
    const { editor, finalize } = createStreamingEditor();
    const enqueue = vi.fn(async () => 'must-not-redeliver');
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: {
        generateStream: vi.fn(async (_input: RewriteGeneratorInput, onChunk) => {
          await onChunk({ chunkId: 'partial-before-error', sequence: 1, text: 'partial' });
          throw new Error('provider stream interrupted');
        }),
      },
      queue: { enqueue },
      requestService: lifecycle,
      workerId: 'worker-stream-partial-error',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });

    expect(result).toMatchObject({
      reason: 'DOCUMENT_REWRITE_WORKER_GENERATOR_INVALID',
      status: 'failed',
    });
    expect(finalize).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(lifecycle.request.status).toBe('failed');
    expect(lifecycle.request.errorMessage).toContain('ended before final output metadata');
  });

  it('fails a stream when the generator ends with a length failure after partial output', async () => {
    const lifecycle = new FakeLifecycle();
    const { editor, finalize } = createStreamingEditor();
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: {
        generateStream: vi.fn(async (_input: RewriteGeneratorInput, onChunk) => {
          await onChunk({ chunkId: 'partial-before-length', sequence: 1, text: 'partial' });
          throw new Error('finish_reason=length');
        }),
      },
      requestService: lifecycle,
      workerId: 'worker-stream-length-error',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });

    expect(result).toMatchObject({
      reason: 'DOCUMENT_REWRITE_WORKER_GENERATOR_INVALID',
      status: 'failed',
    });
    expect(finalize).not.toHaveBeenCalled();
    expect(lifecycle.request.status).toBe('failed');
  });

  it('fails a stream when the generator returns no final metadata after partial output', async () => {
    const lifecycle = new FakeLifecycle();
    const { editor, finalize } = createStreamingEditor();
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: {
        generateStream: vi.fn(async (_input: RewriteGeneratorInput, onChunk) => {
          await onChunk({ chunkId: 'partial-before-metadata', sequence: 1, text: 'partial' });
          return {};
        }),
      },
      requestService: lifecycle,
      workerId: 'worker-stream-no-metadata',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });

    expect(result).toMatchObject({
      reason: 'DOCUMENT_REWRITE_WORKER_GENERATOR_INVALID',
      status: 'failed',
    });
    expect(finalize).not.toHaveBeenCalled();
    expect(lifecycle.request.status).toBe('failed');
  });

  it('retries a busy stream session when the start has not accepted a chunk', async () => {
    const lifecycle = new FakeLifecycle();
    const start = vi.fn(async () => ({
      error: 'stream-session-busy',
      status: 'conflict' as const,
    }));
    const { editor } = createEditor({ startStreamingRewrite: start });
    const enqueue = vi.fn(async () => 'delivery-2');
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: {
        generateStream: vi.fn(async (_input: RewriteGeneratorInput, onChunk) => {
          await onChunk({ chunkId: 'chunk-1', sequence: 1, text: 'retry me' });
          return {};
        }),
      },
      maxAttempts: 3,
      queue: { enqueue },
      requestService: lifecycle,
      retryBackoffMs: () => 321,
      workerId: 'worker-1',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });

    expect(result).toMatchObject({
      attempt: 2,
      reason: DOCUMENT_REWRITE_WORKER_STREAM_SESSION_BUSY,
      status: 'retry_wait',
    });
    expect(lifecycle.request).toMatchObject({
      attempt: 2,
      errorCode: DOCUMENT_REWRITE_WORKER_STREAM_SESSION_BUSY,
      status: 'retry_wait',
    });
    expect(enqueue).toHaveBeenCalledWith({ attempt: 2, requestId: 'request-1' }, { delayMs: 321 });
    expect(lifecycle.transitions.some((transition) => transition.status === 'failed')).toBe(false);
    expect(start).toHaveBeenCalledOnce();
  });

  it('does not retry a busy error after a stream write has been attempted', async () => {
    const lifecycle = new FakeLifecycle();
    const abort = vi.fn(async () => undefined);
    const { append, editor } = createStreamingEditor();
    append.mockRejectedValue(new Error('stream-session-busy'));
    editor.startStreamingRewrite = vi.fn(async () => ({ append, abort, finalize: vi.fn() }));
    const enqueue = vi.fn(async () => 'delivery-2');
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: {
        generateStream: vi.fn(async (_input: RewriteGeneratorInput, onChunk) => {
          await onChunk({ chunkId: 'chunk-1', sequence: 1, text: 'already sent' });
          return { replacementText: 'already sent' };
        }),
      },
      maxAttempts: 3,
      queue: { enqueue },
      requestService: lifecycle,
      workerId: 'worker-1',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });

    expect(result).toMatchObject({
      reason: 'DOCUMENT_REWRITE_WORKER_LEASE_LOST',
      status: 'deferred',
    });
    expect(enqueue).not.toHaveBeenCalled();
    expect(lifecycle.request.attempt).toBe(1);
    expect(lifecycle.request.status).toBe('writing');
    expect(abort).toHaveBeenCalledOnce();
  });

  it('paces one complete provider sentence into grapheme-safe appends', async () => {
    const lifecycle = new FakeLifecycle();
    const { append, editor } = createStreamingEditor();
    const sentence = '如同真人般逐字协作写入文档。';
    const graphemes = segmentRewriteGraphemes(sentence);
    const generator = {
      generateStream: vi.fn(async (_input: RewriteGeneratorInput, onChunk) => {
        await onChunk({ chunkId: 'whole-sentence', sequence: 1, text: sentence });
        return { replacementText: sentence };
      }),
    };
    const startedAt = Date.now();
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator,
      requestService: lifecycle,
      streamingGraphemePacingMs: 35,
      workerId: 'worker-1',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });

    expect(result).toMatchObject({ status: 'applied' });
    expect(append.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(append.mock.calls.length).toBeLessThanOrEqual(graphemes.length);
    const appendedText = append.mock.calls.map(([payload]) => payload.text as string).join('');
    expect(appendedText).toBe(sentence);
    expect(
      append.mock.calls.every(([payload]) => {
        const text = payload.text as string;
        return segmentRewriteGraphemes(text).join('') === text;
      }),
    ).toBe(true);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual((append.mock.calls.length - 1) * 30);
  }, 15_000);

  it('keeps emoji, combining marks, and ZWJ sequences intact across provider chunks', async () => {
    expect(segmentRewriteGraphemes('A👩‍💻e\u0301🇨🇳。')).toEqual(['A', '👩‍💻', 'e\u0301', '🇨🇳', '。']);

    const lifecycle = new FakeLifecycle();
    const { append, editor } = createStreamingEditor();
    const generator = {
      generateStream: vi.fn(async (_input: RewriteGeneratorInput, onChunk) => {
        // Split in the middle of both a combining sequence and a ZWJ emoji;
        // the pump must reassemble them before appending.
        await onChunk({ chunkId: 'chunk-a', sequence: 1, text: 'e' });
        await onChunk({ chunkId: 'chunk-b', sequence: 2, text: '\u0301👩‍' });
        await onChunk({ chunkId: 'chunk-c', sequence: 3, text: '💻' });
        return { replacementText: 'é👩‍💻' };
      }),
    };
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator,
      requestService: lifecycle,
      streamingGraphemePacingMs: 35,
      workerId: 'worker-1',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      status: 'applied',
    });
    expect(append.mock.calls.map(([payload]) => payload.text)).toEqual(['e\u0301', '👩‍💻']);
  });

  it('releases an ordinary tail grapheme while a provider frame remains open', async () => {
    const lifecycle = new FakeLifecycle();
    const { append, editor } = createStreamingEditor();
    let firstAppendAt = 0;
    append.mockImplementation(async () => {
      firstAppendAt ||= Date.now();
    });
    const startedAt = Date.now();
    const generator = {
      generateStream: vi.fn(async (_input: RewriteGeneratorInput, onChunk) => {
        await onChunk({ chunkId: 'open-frame', sequence: 1, text: 'Hi' });
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        return { replacementText: 'Hi' };
      }),
    };
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator,
      requestService: lifecycle,
      streamingGraphemePacingMs: 35,
      workerId: 'worker-1',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      status: 'applied',
    });
    expect(firstAppendAt - startedAt).toBeLessThan(80);
    expect(append.mock.calls.map(([payload]) => payload.text).join('')).toBe('Hi');
  });

  it('bounds long one-shot output and stops before building an unbounded queue', async () => {
    const lifecycle = new FakeLifecycle();
    const { append, editor } = createStreamingEditor();
    const longText = 'x'.repeat(DOCUMENT_REWRITE_MAX_GENERATED_OUTPUT_BYTES + 1);
    const generator = {
      generateStream: vi.fn(async (_input: RewriteGeneratorInput, onChunk) => {
        await onChunk({ chunkId: 'long-output', sequence: 1, text: longText });
        return {};
      }),
    };
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator,
      requestService: lifecycle,
      streamingGraphemePacingMs: 35,
      workerId: 'worker-1',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });

    expect(result).toMatchObject({
      reason: 'DOCUMENT_REWRITE_WORKER_GENERATOR_INVALID',
      status: 'failed',
    });
    expect(append.mock.calls.length).toBeLessThanOrEqual(1);
  }, 15_000);

  it('adapts the Editor method-based session API with a durable session id', async () => {
    const lifecycle = new FakeLifecycle();
    const appendStreamingRewrite = vi.fn(async (input: { text?: string; sequence?: number }) => ({
      affectedNodeIds: ['node-start'],
      generationId: 'generation-method',
      requestId: 'request-1',
      sequence: input.sequence,
      sessionId: 'request-1:attempt:1',
      status: 'streaming' as const,
    }));
    const finalizeStreamingRewrite = vi.fn(async () => ({
      affectedNodeIds: ['node-start'],
      generationId: 'generation-method',
      requestId: 'request-1',
      sessionId: 'request-1:attempt:1',
      status: 'applied' as const,
    }));
    const abortStreamingRewrite = vi.fn(async () => ({
      affectedNodeIds: [],
      generationId: 'generation-method',
      requestId: 'request-1',
      sessionId: 'request-1:attempt:1',
      status: 'aborted' as const,
    }));
    const { editor } = createEditor({
      appendStreamingRewrite,
      finalizeStreamingRewrite,
      startStreamingRewrite: vi.fn(async () => ({
        affectedNodeIds: ['node-start'],
        generationId: 'generation-method',
        requestId: 'request-1',
        sequence: 0,
        sessionId: 'request-1:attempt:1',
        status: 'streaming' as const,
      })),
      abortStreamingRewrite,
    });
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: {
        generateStream: vi.fn(async (_input: RewriteGeneratorInput, onChunk) => {
          await onChunk.onStart?.({ generationId: 'generation-method' });
          await onChunk({ chunkId: 'chunk-1', sequence: 1, text: 'method' });
          return { generationId: 'generation-method', replacementText: 'method' };
        }),
      },
      requestService: lifecycle,
      streamingFlushMs: 30,
      workerId: 'worker-1',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });

    expect(result).toMatchObject({ commandId: 'request-1:attempt:1', status: 'applied' });
    expect(appendStreamingRewrite).toHaveBeenCalled();
    expect(
      appendStreamingRewrite.mock.calls
        .map(([payload]) => (payload as { text: string }).text)
        .join(''),
    ).toBe('method');
    expect(
      appendStreamingRewrite.mock.calls.every(
        ([payload]) => (payload as { sessionId: string }).sessionId === 'request-1:attempt:1',
      ),
    ).toBe(true);
    expect(finalizeStreamingRewrite).toHaveBeenCalledWith({
      sessionId: 'request-1:attempt:1',
    });
    expect(abortStreamingRewrite).not.toHaveBeenCalled();
  });

  it('cancels before the first append and drops queued provider text', async () => {
    const lifecycle = new FakeLifecycle();
    const { append, editor, finalize } = createStreamingEditor();
    const abort = vi.fn(async () => undefined);
    editor.startStreamingRewrite = vi.fn(async () => ({ append, finalize, abort }));
    const generator = {
      generate: vi.fn(async () => ({ replacementText: 'legacy result' })),
      generateStream: vi.fn(async (_input: RewriteGeneratorInput, onChunk) => {
        lifecycle.request = {
          ...lifecycle.request,
          cancelRequestedAt: new Date(),
          status: 'cancel_requested',
        };
        await onChunk({ chunkId: 'chunk-1', sequence: 1, text: 'queued only' });
        return { replacementText: 'queued only' };
      }),
    };
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator,
      requestService: lifecycle,
      streamingFlushMs: 80,
      workerId: 'worker-1',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });

    expect(result).toMatchObject({
      reason: 'DOCUMENT_REWRITE_WORKER_CANCELED',
      status: 'canceled',
    });
    expect(append).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
    expect(lifecycle.request.status).toBe('canceled');
  });

  it('serializes a fast callback fanout and never duplicates chunk ids', async () => {
    const lifecycle = new FakeLifecycle();
    const { append, editor } = createStreamingEditor();
    append.mockImplementation(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    });
    const chunks = Array.from({ length: 120 }, (_, index) => ({
      chunkId: `chunk-${index + 1}`,
      sequence: index + 1,
      text: 'x',
    }));
    const generator = {
      generate: vi.fn(async () => ({ replacementText: 'legacy result' })),
      generateStream: vi.fn(async (_input: RewriteGeneratorInput, onChunk) => {
        // Deliberately ignore each callback promise, as a provider parser may.
        chunks.forEach((chunk) => void onChunk(chunk));
        return { replacementText: chunks.map(({ text }) => text).join('') };
      }),
    };
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator,
      requestService: lifecycle,
      streamingFlushMs: 30,
      workerId: 'worker-1',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      status: 'applied',
    });
    expect(append.mock.calls.length).toBeGreaterThanOrEqual(60);
    expect(append.mock.calls.length).toBeLessThanOrEqual(120);
    const payloads = append.mock.calls.map(([payload]) => payload as { text: string });
    expect(payloads.map(({ text }) => text).join('')).toBe('x'.repeat(120));
    expect(new Set(append.mock.calls.map(([payload]) => payload.chunkId)).size).toBe(
      append.mock.calls.length,
    );
  });

  it('stops and cancels when the protected target region disappears mid-stream', async () => {
    const lifecycle = new FakeLifecycle();
    const { append, editor, finalize } = createStreamingEditor();
    let appendCount = 0;
    append.mockImplementation(async () => {
      appendCount += 1;
      if (appendCount === 2) {
        return {
          affectedNodeIds: [],
          commandId: 'stream-command-1',
          error: 'region_missing',
          requestId: 'request-1',
          status: 'failed' as const,
        };
      }
      return undefined;
    });
    const generator = {
      generate: vi.fn(async () => ({ replacementText: 'legacy result' })),
      generateStream: vi.fn(async (_input: RewriteGeneratorInput, onChunk) => {
        await onChunk({ chunkId: 'chunk-1', sequence: 1, text: 'first' });
        await new Promise<void>((resolve) => setTimeout(resolve, 40));
        await onChunk({ chunkId: 'chunk-2', sequence: 2, text: 'second' });
        await new Promise<void>((resolve) => setTimeout(resolve, 40));
        await expect(onChunk({ chunkId: 'chunk-3', sequence: 3, text: 'late' })).rejects.toThrow(
          'region',
        );
        // A late provider callback must be ignored after the region terminal
        // condition; it must not revive/finalize the session.
        return { replacementText: 'firstsecondlate' };
      }),
    };
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator,
      requestService: lifecycle,
      streamingFlushMs: 30,
      workerId: 'worker-1',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });

    expect(result).toMatchObject({
      reason: 'DOCUMENT_REWRITE_WORKER_REGION_MISSING',
      status: 'canceled_after_write',
    });
    expect(append).toHaveBeenCalledTimes(2);
    expect(finalize).not.toHaveBeenCalled();
    expect(lifecycle.request.status).toBe('canceled_after_write');
    expect(editor.clearAwareness).toHaveBeenCalled();
  });

  it('stops on generation conflict, marks stale, and never finalizes the partial stream', async () => {
    const lifecycle = new FakeLifecycle();
    const { append, editor, finalize } = createStreamingEditor();
    const abort = vi.fn(async () => undefined);
    editor.startStreamingRewrite = vi.fn(async () => ({ append, finalize, abort }));
    append.mockResolvedValue({
      affectedNodeIds: [],
      commandId: 'request-1:attempt:1',
      error: 'generation_mismatch',
      requestId: 'request-1',
      status: 'conflict' as const,
    });
    const generator = {
      generateStream: vi.fn(async (_input: RewriteGeneratorInput, onChunk) => {
        await onChunk({ chunkId: 'chunk-1', sequence: 1, text: 'must stop' });
        await new Promise<void>((resolve) => setTimeout(resolve, 40));
        await onChunk({ chunkId: 'chunk-2', sequence: 2, text: 'late' }).catch(() => undefined);
        return { replacementText: 'must stop late' };
      }),
    };
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator,
      requestService: lifecycle,
      streamingFlushMs: 30,
      workerId: 'worker-1',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });

    expect(result).toMatchObject({
      reason: 'DOCUMENT_REWRITE_WORKER_GENERATION_CONFLICT',
      status: 'stale',
    });
    expect(finalize).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledOnce();
    expect(lifecycle.request.status).toBe('stale');
  });

  it('aborts an ambiguous append failure without retrying or replaying chunks', async () => {
    const lifecycle = new FakeLifecycle();
    const abort = vi.fn(async () => undefined);
    const { append, editor } = createStreamingEditor();
    append.mockRejectedValue(new Error('relay unavailable after write')); // ambiguous outcome
    const start = vi.fn(async () => ({ append, abort, finalize: vi.fn() }));
    editor.startStreamingRewrite = start;
    const generator = {
      generate: vi.fn(async () => ({ replacementText: 'legacy result' })),
      generateStream: vi.fn(async (_input: RewriteGeneratorInput, onChunk) => {
        await onChunk({ chunkId: 'chunk-1', sequence: 1, text: 'partial' });
        return { replacementText: 'partial result' };
      }),
    };
    const enqueue = vi.fn(async () => 'delivery-2');
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator,
      maxAttempts: 3,
      queue: { enqueue },
      requestService: lifecycle,
      streamingFlushMs: 30,
      workerId: 'worker-1',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });

    expect(result).toMatchObject({
      commandId: 'request-1:attempt:1',
      status: 'deferred',
    });
    expect(generator.generateStream).toHaveBeenCalledOnce();
    expect(enqueue).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledOnce();
    expect(lifecycle.request.status).toBe('writing');
  });

  it('cleans an orphaned durable stream marker before closing a recovered attempt', async () => {
    const lifecycle = new FakeLifecycle();
    lifecycle.request = {
      ...lifecycle.request,
      generationId: 'orphan-generation',
      lastCommandId: 'request-1:attempt:1',
      status: 'writing',
    };
    lifecycle.claim = async (_id, input) => {
      lifecycle.request = {
        ...lifecycle.request,
        claimOwner: input.workerId,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        status: 'connecting',
      };
      return lifecycle.request;
    };
    lifecycle.markDirectApplied = async () => undefined;
    const recoverRewriteSession = vi.fn(async () => undefined);
    const { editor } = createEditor({ recoverRewriteSession });
    const generator = vi.fn(async () => ({ replacementText: 'must not regenerate' }));
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator,
      requestService: lifecycle,
      workerId: 'worker-1',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });

    expect(result).toMatchObject({ status: 'stale' });
    expect(recoverRewriteSession).toHaveBeenCalledWith({
      generationId: 'orphan-generation',
      requestId: 'request-1',
      sessionId: 'request-1:attempt:1',
    });
    expect(generator).not.toHaveBeenCalled();
  });

  it('does not settle partial request history as applied without final output', async () => {
    const lifecycle = new FakeLifecycle();
    lifecycle.request = {
      ...lifecycle.request,
      generationId: 'partial-generation',
      lastCommandId: 'request-1:attempt:1',
      outputText: null,
      status: 'writing',
    };
    lifecycle.claim = async (_id, input) => {
      lifecycle.request = {
        ...lifecycle.request,
        claimOwner: input.workerId,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        status: 'connecting',
      };
      return lifecycle.request;
    };
    const markDirectApplied = vi.spyOn(lifecycle, 'markDirectApplied');
    const recoverRewriteSession = vi.fn(async () => undefined);
    const { editor } = createEditor({ recoverRewriteSession });
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: vi.fn(async () => ({ replacementText: 'must not regenerate' })),
      requestService: lifecycle,
      workerId: 'worker-partial-history',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });

    expect(result).toMatchObject({ status: 'stale' });
    expect(markDirectApplied).not.toHaveBeenCalled();
    expect(lifecycle.request.status).toBe('stale');
  });

  it('recovers a finalized request-linked write exactly once', async () => {
    const lifecycle = new FakeLifecycle();
    lifecycle.request = {
      ...lifecycle.request,
      generationId: 'final-generation',
      lastCommandId: 'request-1:attempt:1',
      outputText: 'final output',
      status: 'writing',
    };
    lifecycle.claim = async (_id, input) => {
      lifecycle.request = {
        ...lifecycle.request,
        claimOwner: input.workerId,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        status: 'connecting',
      };
      return lifecycle.request;
    };
    const markDirectApplied = vi.spyOn(lifecycle, 'markDirectApplied');
    const { editor } = createEditor();
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: vi.fn(async () => ({ replacementText: 'must not regenerate' })),
      requestService: lifecycle,
      workerId: 'worker-final-history',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });

    expect(result).toMatchObject({ status: 'applied' });
    expect(markDirectApplied).toHaveBeenCalledOnce();
    expect(lifecycle.request.outputText).toBe('final output');
  });

  it('accepts the canonical cross-paragraph quote across the Page worker boundary', async () => {
    const capturedSelection = makeSelection('First\nSecond');
    const lifecycle = new FakeLifecycle(makeRequest(capturedSelection));
    const { editor } = createEditor({
      // Older browser bundles can persist Lexical's block separator while
      // newer headless resolvers expose the transport-canonical space.
      resolveSelection: vi.fn(() => ({
        endNodeId: 'node-start',
        quotedText: 'First Second',
        selection: {},
        startNodeId: 'node-start',
      })) as unknown as CollaborativeAgentEditorSession['resolveSelection'],
    });
    let generatorInput!: RewriteGeneratorInput;
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: async (input) => {
        generatorInput = input;
        return { replacementText: 'Concise text' };
      },
      requestService: lifecycle,
      workerId: 'worker-1',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      status: 'applied',
    });
    expect(generatorInput.quotedText).toBe('First Second');
    expect(lifecycle.request.status).toBe('applied');
  });

  it('upgrades a legacy raw cross-paragraph hash before direct dispatch', async () => {
    const capturedSelection = {
      ...makeSelection('First\nSecond'),
      // FNV-1a over the raw pre-normalization quote emitted by an older editor
      // bundle. The worker must retain the range proof but dispatch the
      // canonical hash expected by the current command validator.
      quotedTextHash: 'fnv1a-432e5ef9',
    };
    const lifecycle = new FakeLifecycle(makeRequest(capturedSelection));
    const { editor } = createEditor({
      resolveSelection: vi.fn(() => ({
        endNodeId: 'node-start',
        quotedText: 'First Second',
        selection: {},
        startNodeId: 'node-start',
      })) as unknown as CollaborativeAgentEditorSession['resolveSelection'],
    });
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: async () => ({ replacementText: 'Concise text' }),
      requestService: lifecycle,
      workerId: 'worker-1',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      status: 'applied',
    });
    expect(vi.mocked(editor.dispatchCommand).mock.calls[0]?.[1]).toMatchObject({
      expectedTextHash: hashRewriteText('First Second'),
      mode: 'direct',
    });
  });

  it('routes the development deterministic output through the normal Yjs command and provenance path', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(DOCUMENT_REWRITE_MOCK_REPLACEMENT_TEXT_ENV, 'Deterministic direct text');
    const lifecycle = new FakeLifecycle();
    const { editor } = createEditor();
    const generator = createProductionRewriteGenerator(
      {
        db: {} as never,
      },
      { agentId: 'agent-1', db: {} as never, requestedByUserId: 'user-1', workspaceId: null },
    );
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator,
      requestService: lifecycle,
      workerId: 'worker-1',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });

    expect(result).toMatchObject({ commandId: 'command-1', status: 'applied' });
    expect(editor.dispatchCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        generationId: 'request-1:generation:1',
        model: DOCUMENT_REWRITE_MOCK_MODEL,
        mode: 'direct',
        provider: DOCUMENT_REWRITE_MOCK_PROVIDER,
        replacementText: 'Deterministic direct text',
      }),
    );
    expect(lifecycle.transitions.map((transition) => transition.status)).toEqual([
      'syncing',
      'thinking',
      'writing',
      'applied',
    ]);
    expect(editor.disconnect).toHaveBeenCalledTimes(1);
  });

  it('waits for durable persistence before settling a direct rewrite', async () => {
    const lifecycle = new FakeLifecycle();
    const { editor, states } = createEditor();
    let persistenceChecks = 0;
    const markDirectApplied = lifecycle.markDirectApplied;
    lifecycle.markDirectApplied = async (...args) => {
      persistenceChecks += 1;
      if (persistenceChecks === 1) return undefined;
      return markDirectApplied(...args);
    };
    const worker = new DocumentRewriteWorker({
      directPersistencePollMs: 1,
      editorFactory: factoryFor(editor),
      generator: async () => ({ replacementText: 'Concise text' }),
      requestService: lifecycle,
      workerId: 'worker-1',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      status: 'applied',
    });
    expect(persistenceChecks).toBe(2);
    expect(editor.disconnect).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe('done');
  });

  it('does not expose a review awareness phase for direct rewrites', async () => {
    const lifecycle = new FakeLifecycle();
    const { editor, states } = createEditor();
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: async () => ({ replacementText: 'Concise text' }),
      requestService: lifecycle,
      workerId: 'worker-1',
    });

    await worker.process({ attempt: 1, requestId: 'request-1' });
    await vi.waitFor(() => expect(editor.disconnect).toHaveBeenCalledTimes(1));
    expect(states).not.toContain('awaiting-review');
    expect(states.at(-1)).toBe('done');
  });

  it('does not wait forever when the room sync barrier never settles', async () => {
    const lifecycle = new FakeLifecycle();
    const { editor } = createEditor({
      waitForSync: vi.fn(() => new Promise<void>(() => {})),
    });
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: async () => ({ replacementText: 'never reached' }),
      maxAttempts: 1,
      requestService: lifecycle,
      syncTimeoutMs: 1,
      workerId: 'worker-1',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      reason: DOCUMENT_REWRITE_WORKER_SYNC_TIMEOUT,
      status: 'failed',
    });
    expect(editor.disconnect).toHaveBeenCalledTimes(1);
  });

  it('bounds editor connection setup and releases the attempt for retry', async () => {
    const lifecycle = new FakeLifecycle();
    const { editor } = createEditor({
      connect: vi.fn(() => new Promise<void>(() => {})),
    });
    const worker = new DocumentRewriteWorker({
      editorFactory: { create: vi.fn(async () => editor) },
      generator: async () => ({ replacementText: 'never reached' }),
      maxAttempts: 2,
      requestService: lifecycle,
      connectTimeoutMs: 1,
      retryBackoffMs: () => 0,
      workerId: 'worker-1',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      attempt: 2,
      reason: DOCUMENT_REWRITE_WORKER_SYNC_TIMEOUT,
      status: 'retry_wait',
    });
    expect(lifecycle.request).toMatchObject({ attempt: 2, status: 'retry_wait' });
    expect(editor.disconnect).toHaveBeenCalled();
  });

  it('treats a redelivered message after a direct write as an idempotent applied state', async () => {
    const lifecycle = new FakeLifecycle();
    const firstEditor = createEditor();
    const connect = vi.fn(async () => firstEditor.editor);
    const worker = new DocumentRewriteWorker({
      editorFactory: { connect },
      generator: async () => ({ replacementText: 'Concise text' }),
      requestService: lifecycle,
      workerId: 'worker-1',
    });

    await worker.process({ attempt: 1, requestId: 'request-1' });
    const second = await worker.process({ attempt: 1, requestId: 'request-1' });
    expect(second.status).toBe('applied');
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('publishes connecting before a pre-connect adapter settles auth/sync', async () => {
    const lifecycle = new FakeLifecycle();
    const { editor, states } = createEditor();
    let release!: () => void;
    const factory: CollaborativeAgentEditorFactory = {
      connect: vi.fn(async () => editor),
      create: vi.fn(async () => editor),
    };
    editor.connect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const worker = new DocumentRewriteWorker({
      editorFactory: factory,
      generator: async () => ({ replacementText: 'next' }),
      requestService: lifecycle,
      workerId: 'worker-1',
    });

    const running = worker.process({ attempt: 1, requestId: 'request-1' });
    await vi.waitFor(() => expect(release).toEqual(expect.any(Function)));
    expect(states[0]).toBe('connecting');
    release();
    await running;
  });

  it('checks durable cancellation before issuing a room ticket or opening the provider', async () => {
    const lifecycle = new FakeLifecycle();
    const originalClaim = lifecycle.claim;
    lifecycle.claim = async (...args) => {
      const claimed = await originalClaim(...args);
      lifecycle.request = {
        ...lifecycle.request,
        cancelRequestedAt: new Date(),
        status: 'cancel_requested',
      };
      return claimed;
    };
    const { editor } = createEditor();
    const connect = vi.fn(async () => editor);
    const worker = new DocumentRewriteWorker({
      editorFactory: { connect },
      generator: async () => ({ replacementText: 'never' }),
      requestService: lifecycle,
      workerId: 'worker-1',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });
    expect(result.status).toBe('canceled');
    expect(lifecycle.ticketInputs).toEqual([]);
    expect(connect).not.toHaveBeenCalled();
  });

  it('marks a selection that no longer resolves stale without invoking the generator', async () => {
    const lifecycle = new FakeLifecycle();
    const { editor } = createEditor({
      inspectRewriteTargets: vi.fn(() => ({
        existingNodeIds: ['node-start'],
        missingNodeIds: [],
      })),
      resolveSelection: vi.fn(() => null),
    });
    const generator = vi.fn(async () => ({ replacementText: 'never' }));
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator,
      requestService: lifecycle,
      workerId: 'worker-1',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });
    expect(result.status).toBe('stale');
    expect(generator).not.toHaveBeenCalled();
    expect(lifecycle.transitions.at(-1)).toMatchObject({ status: 'stale' });
  });

  it('fuses transient generator errors into a delayed next attempt', async () => {
    const lifecycle = new FakeLifecycle();
    const { editor } = createEditor();
    const enqueue = vi.fn(async () => 'delivery-2');
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: async () => {
        throw new Error('provider timeout');
      },
      maxAttempts: 3,
      queue: { enqueue },
      requestService: lifecycle,
      retryBackoffMs: () => 321,
      workerId: 'worker-1',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });
    expect(result).toMatchObject({ attempt: 2, reason: 'Error', status: 'retry_wait' });
    expect(enqueue).toHaveBeenCalledWith({ attempt: 2, requestId: 'request-1' }, { delayMs: 321 });
    expect(lifecycle.request).toMatchObject({ attempt: 2, status: 'retry_wait' });
  });

  it('persists safe generation diagnostics on retry when progress is reset', async () => {
    const lifecycle = new FakeLifecycle();
    lifecycle.request = {
      ...lifecycle.request,
      errorMessage: 'prior_attempt_diagnostics',
    };
    const { editor } = createEditor();
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: async () => {
        throw Object.assign(new Error('Document rewrite model generation failed'), {
          code: 'DOCUMENT_REWRITE_PRODUCTION_MODEL_ERROR:truncated',
          diagnostics: {
            finishReason: 'length',
            outputBytes: 15_893,
            outputCharacters: 15_893,
            outputTextTokens: 16_384,
            requestedMaxTokens: 16_384,
            streamError: false,
            totalOutputTokens: 16_384,
            usagePresent: false,
          },
          retryable: true,
        });
      },
      maxAttempts: 3,
      requestService: lifecycle,
      workerId: 'worker-diagnostics-retry',
    });

    await expect(worker.process({ attempt: 1, requestId: 'request-1' })).resolves.toMatchObject({
      attempt: 2,
      status: 'retry_wait',
    });
    expect(lifecycle.request.errorMessage).toContain(
      'finish_reason=length output_chars=15893 output_bytes=15893 output_tokens=16384 total_tokens=16384 max_tokens=16384 stream_error=no usage_present=no',
    );
    expect(lifecycle.request.errorMessage).toContain('prior_attempt_diagnostics');
    expect(lifecycle.request.errorMessage).not.toContain('Original text');
  });

  it('records an allowlisted command failure as terminal without retrying the model', async () => {
    const lifecycle = new FakeLifecycle();
    const { editor } = createEditor({
      dispatchCommand: vi.fn(async () => ({
        affectedNodeIds: [],
        commandId: 'command-failed',
        error: 'preflight rejected nested Diff',
        requestId: 'request-1',
        status: 'failed' as const,
      })),
    });
    const generator = vi.fn(async () => ({ replacementText: 'next' }));
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator,
      requestService: lifecycle,
      workerId: 'worker-1',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });
    expect(result).toMatchObject({
      reason: 'DOCUMENT_REWRITE_WORKER_COMMAND_FAILED',
      status: 'failed',
    });
    expect(lifecycle.request.status).toBe('failed');
  });

  it('cancels cooperatively after model generation but before command submission', async () => {
    const lifecycle = new FakeLifecycle();
    const { editor } = createEditor();
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: async () => {
        lifecycle.request = {
          ...lifecycle.request,
          cancelRequestedAt: new Date(),
          status: 'cancel_requested',
        };
        return { replacementText: 'never written' };
      },
      requestService: lifecycle,
      workerId: 'worker-1',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });
    expect(result.status).toBe('canceled');
    expect(editor.dispatchCommand).not.toHaveBeenCalled();
  });

  it('settles cancellation after a direct write as applied without rollback', async () => {
    const lifecycle = new FakeLifecycle();
    const { editor } = createEditor({
      dispatchCommand: vi.fn(async () => {
        lifecycle.request = {
          ...lifecycle.request,
          cancelRequestedAt: new Date(),
          status: 'cancel_requested',
        };
        return {
          affectedNodeIds: ['node-start'],
          commandId: 'command-raced-cancel',
          requestId: 'request-1',
          status: 'applied' as const,
        } as unknown as RewriteCommandResult;
      }),
    });
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: async () => ({ replacementText: 'pending review' }),
      requestService: lifecycle,
      workerId: 'worker-1',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });
    expect(result).toMatchObject({
      commandId: 'command-raced-cancel',
      status: 'applied',
    });
    expect(result.reason).toBe('DOCUMENT_REWRITE_WORKER_CANCELED');
    expect(lifecycle.request).toMatchObject({ status: 'applied' });
    expect(editor.disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not mutate a request after a lost lease; recovery can redeliver the same attempt', async () => {
    const lifecycle = new FakeLifecycle();
    let renewals = 0;
    lifecycle.renewLease = async () => {
      renewals += 1;
      return renewals > 1 ? undefined : lifecycle.request;
    };
    const { editor } = createEditor();
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(editor),
      generator: async () => ({ replacementText: 'next' }),
      requestService: lifecycle,
      workerId: 'worker-1',
    });

    const result = await worker.process({ attempt: 1, requestId: 'request-1' });
    expect(result).toMatchObject({
      reason: 'DOCUMENT_REWRITE_WORKER_LEASE_LOST',
      status: 'deferred',
    });
    expect(lifecycle.transitions.some((transition) => transition.status === 'failed')).toBe(false);
    expect(lifecycle.transitions.some((transition) => transition.status === 'retry_wait')).toBe(
      false,
    );
  });

  it('recovers a crashed active attempt with the same attempt number', async () => {
    const lifecycle = new FakeLifecycle({
      ...makeRequest(),
      claimOwner: 'dead-worker',
      leaseExpiresAt: new Date(Date.now() - 1),
      status: 'writing',
    });
    lifecycle.listRunnable = async () => [lifecycle.request];
    const enqueue = vi.fn(async () => 'delivery-1');
    const worker = new DocumentRewriteWorker({
      editorFactory: factoryFor(createEditor().editor),
      generator: async () => ({ replacementText: 'next' }),
      queue: { enqueue },
      requestService: lifecycle,
      workerId: 'worker-restarted',
    });

    await expect(worker.recoverRunnable()).resolves.toEqual({ enqueued: 1, processed: 0 });
    expect(enqueue).toHaveBeenCalledWith({ attempt: 1, requestId: 'request-1' });
  });

  it('sweeps durable pending reviews before recovering runnable deliveries', async () => {
    const lifecycle = new FakeLifecycle();
    const sweepPendingReviews = vi.fn(async () => 1);
    lifecycle.sweepPendingReviews = sweepPendingReviews;
    lifecycle.listRunnable = async () => [];
    const worker = new DocumentRewriteWorker({
      generator: async () => ({ replacementText: 'unused' }),
      requestService: lifecycle,
      workerId: 'worker-restarted',
    });

    await expect(worker.recoverRunnable()).resolves.toEqual({ enqueued: 0, processed: 0 });
    expect(sweepPendingReviews).toHaveBeenCalledOnce();
  });
});
