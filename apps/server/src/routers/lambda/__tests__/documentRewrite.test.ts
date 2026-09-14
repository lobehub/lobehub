// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  agentAccess: vi.fn(),
  documentAccess: vi.fn(),
  documentFindById: vi.fn(),
  service: {
    cancel: vi.fn(),
    continue: vi.fn(),
    create: vi.fn(),
    deleteSession: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    retry: vi.fn(),
    settleReview: vi.fn(),
  },
}));

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(function () {
    return { findById: mocks.documentFindById };
  }),
}));
vi.mock('@/database/utils/agent-access', () => ({
  assertAgentUsableBy: mocks.agentAccess,
}));
vi.mock('@/server/services/resourcePermission', () => ({
  assertCanPerformResourceAction: mocks.documentAccess,
}));
vi.mock('@/server/services/documentRewrite', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '@/server/services/documentRewrite',
  );
  return {
    ...actual,
    DocumentRewriteRequestService: vi.fn(function () {
      return mocks.service;
    }),
  };
});
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return { wsCompatProcedure: mod.trpc.procedure };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: opts.ctx.serverDB ?? {} } }),
}));

const { documentRewriteRouter } = await import('../documentRewrite');

const selection = {
  anchorPos: { assoc: 0, tname: 'root' },
  baseStateVector: 'state-vector',
  capturedAt: '2026-08-28T00:00:00.000Z',
  focusPos: { assoc: 0, tname: 'root' },
  kind: 'relative' as const,
  quotedText: 'Original text',
  quotedTextHash: 'hash:Original text',
  roomId: 'room-1',
};

const nodeSelection = {
  adapterId: 'artifact',
  endNodeId: 'artifact-1',
  endOffset: 1,
  kind: 'block' as const,
  quotedText: 'Artifact',
  quotedTextHash: 'hash:artifact',
  sourceHash: 'hash:source',
  startNodeId: 'artifact-1',
  startOffset: 0,
  targetKind: 'node' as const,
  targetNodeId: 'artifact-1',
  targetNodeIds: ['artifact-1'],
};

const request = {
  agentId: 'agent-1',
  attempt: 1,
  documentId: 'document-1',
  id: 'request-1',
  lastCommandId: 'command-1',
  status: 'awaiting_review' as const,
};

const callerFor = (workspaceId?: string) =>
  documentRewriteRouter.createCaller({
    serverDB: {},
    userId: 'user-1',
    workspaceId: workspaceId ?? null,
  } as any);

describe('documentRewriteRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentAccess.mockResolvedValue(undefined);
    mocks.documentAccess.mockResolvedValue(undefined);
    mocks.documentFindById.mockResolvedValue({ id: 'document-1' });
    mocks.service.create.mockResolvedValue({ isDuplicate: false, request });
    mocks.service.findById.mockResolvedValue(request);
    mocks.service.list.mockResolvedValue([request]);
    mocks.service.cancel.mockResolvedValue({ isDuplicate: false, request });
    mocks.service.continue.mockResolvedValue({
      isDuplicate: false,
      request: { ...request, id: 'request-2', parentRequestId: 'request-1' },
    });
    mocks.service.deleteSession.mockResolvedValue({
      deletedCount: 2,
      documentId: 'document-1',
      requestId: 'request-1',
      sessionId: 'session-1',
    });
    mocks.service.retry.mockResolvedValue({ isDuplicate: false, request });
    mocks.service.settleReview.mockResolvedValue({ isDuplicate: false, request });
  });

  it('checks document edit and agent access before creating an idempotent request', async () => {
    const result = await callerFor('workspace-1').create({
      agentId: 'agent-1',
      documentId: 'document-1',
      id: 'request-1',
      instruction: 'Make it concise',
      selection,
    });

    expect(mocks.documentAccess).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'edit', resourceId: 'document-1' }),
    );
    expect(mocks.agentAccess).toHaveBeenCalledWith({}, 'agent-1', {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    expect(mocks.service.create).toHaveBeenCalledWith(
      expect.objectContaining({ selection, instruction: 'Make it concise' }),
    );
    expect(result).toMatchObject({ isDuplicate: false, request: { id: 'request-1' } });
  });

  it('rejects node targets without an explicit collaboration room at the router boundary', async () => {
    await expect(
      callerFor('workspace-1').create({
        agentId: 'agent-1',
        documentId: 'document-1',
        instruction: 'Rewrite the Artifact',
        selection: nodeSelection,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.service.create).not.toHaveBeenCalled();
  });

  it('uses document view ACL for list/get and edit ACL for review mutations', async () => {
    await callerFor('workspace-1').list({ documentId: 'document-1' });
    expect(mocks.documentAccess).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'view', resourceId: 'document-1' }),
    );

    await callerFor('workspace-1').get({ documentId: 'document-1', id: 'request-1' });
    expect(mocks.service.findById).toHaveBeenCalledWith('request-1');

    await callerFor('workspace-1').review({
      attempt: 1,
      expectedCommandId: 'command-1',
      id: 'request-1',
      stateVector: 'proof-state-vector',
      status: 'applied',
    });
    expect(mocks.documentAccess).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'edit', resourceId: 'document-1' }),
    );
    expect(mocks.service.settleReview).toHaveBeenCalledWith('request-1', {
      attempt: 1,
      expectedCommandId: 'command-1',
      status: 'applied',
      stateVector: 'proof-state-vector',
    });
  });

  it('creates a continuation from the parent request without accepting selection/history payloads', async () => {
    const result = await callerFor('workspace-1').continue({
      instruction: 'Make the applied result warmer',
      parentRequestId: 'request-1',
    });

    expect(mocks.documentAccess).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'edit', resourceId: 'document-1' }),
    );
    expect(mocks.service.continue).toHaveBeenCalledWith('request-1', {
      instruction: 'Make the applied result warmer',
    });
    expect(result).toMatchObject({ request: { parentRequestId: 'request-1' } });
  });

  it('accepts the legacy commandId alias but never treats it as a writable audit field', async () => {
    await callerFor('workspace-1').review({
      attempt: 1,
      commandId: 'command-1',
      id: 'request-1',
      stateVector: 'proof-state-vector',
      status: 'rejected',
    });

    expect(mocks.service.settleReview).toHaveBeenCalledWith('request-1', {
      attempt: 1,
      expectedCommandId: 'command-1',
      status: 'rejected',
      stateVector: 'proof-state-vector',
    });
  });

  it('forwards cancel/retry and does not call a service after a denied ACL check', async () => {
    await callerFor('workspace-1').cancel({ attempt: 1, id: 'request-1' });
    expect(mocks.service.cancel).toHaveBeenCalledWith('request-1', { attempt: 1 });
    await callerFor('workspace-1').retry({ attempt: 1, id: 'request-1' });
    expect(mocks.service.retry).toHaveBeenCalledWith('request-1', {
      attempt: 1,
      delayMs: undefined,
    });

    mocks.documentAccess.mockRejectedValueOnce(new TRPCError({ code: 'FORBIDDEN' }));
    await expect(callerFor('workspace-1').cancel({ id: 'request-1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mocks.service.cancel).toHaveBeenCalledTimes(1);
  });

  it('requires document edit access and forwards session deletion by either identity', async () => {
    const result = await callerFor('workspace-1').deleteSession({
      documentId: 'document-1',
      sessionId: 'session-1',
    });
    expect(result).toMatchObject({ deletedCount: 2, sessionId: 'session-1' });
    expect(mocks.documentAccess).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'edit', resourceId: 'document-1' }),
    );
    expect(mocks.service.deleteSession).toHaveBeenCalledWith({
      documentId: 'document-1',
      sessionId: 'session-1',
    });

    await callerFor('workspace-1').deleteSession({
      documentId: 'document-1',
      requestId: 'request-1',
    });
    expect(mocks.service.deleteSession).toHaveBeenLastCalledWith({
      documentId: 'document-1',
      requestId: 'request-1',
    });

    mocks.documentAccess.mockRejectedValueOnce(new TRPCError({ code: 'FORBIDDEN' }));
    await expect(
      callerFor('workspace-1').deleteSession({
        documentId: 'document-1',
        requestId: 'request-1',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.service.deleteSession).toHaveBeenCalledTimes(2);
  });

  it('falls back to personal document ownership when no workspace is scoped', async () => {
    await callerFor().list({ documentId: 'document-1' });
    expect(mocks.documentFindById).toHaveBeenCalledWith('document-1');
    expect(mocks.documentAccess).not.toHaveBeenCalled();
  });

  it('surfaces the targeted rewrite rollback switch without creating a request', async () => {
    mocks.service.create.mockRejectedValueOnce(new Error('DOCUMENT_REWRITE_DISABLED'));

    await expect(
      callerFor('workspace-1').create({
        agentId: 'agent-1',
        documentId: 'document-1',
        instruction: 'Make it concise',
        selection,
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });
});
