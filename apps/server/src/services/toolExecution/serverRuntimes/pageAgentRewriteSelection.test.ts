// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPageAgentRewriteSelectionService } from './pageAgentRewriteSelection';

const mocks = vi.hoisted(() => ({
  agentAccess: vi.fn(),
  documentAccess: vi.fn(),
  documentFindById: vi.fn(),
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

const request = (overrides: Record<string, unknown> = {}) => ({
  agentId: 'agent-1',
  attempt: 2,
  documentId: 'document-1',
  errorCode: null,
  errorMessage: null,
  id: 'request-1',
  requestedByUserId: 'user-1',
  status: 'queued' as const,
  updatedAt: new Date('2026-08-29T00:00:00.000Z'),
  workspaceId: 'workspace-1',
  ...overrides,
});

const context = {
  agentId: 'agent-1',
  documentId: 'document-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
};

describe('Page Agent rewriteSelection adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentAccess.mockResolvedValue(undefined);
    mocks.documentAccess.mockResolvedValue(undefined);
    mocks.documentFindById.mockResolvedValue({ id: 'document-1' });
  });

  it('accepts only requestId/instruction and returns status without selection or snapshot data', async () => {
    const findById = vi.fn().mockResolvedValue(request());
    const enqueueExisting = vi.fn().mockResolvedValue({
      isDuplicate: true,
      request: request(),
    });
    const service = createPageAgentRewriteSelectionService({
      db: {} as never,
      requestService: { enqueueExisting, findById } as never,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    const result = await service(
      { instruction: 'Make it concise', requestId: ' request-1 ' },
      context,
    );

    expect(mocks.documentAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'edit',
        resourceId: 'document-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    );
    expect(mocks.agentAccess).toHaveBeenCalledWith({}, 'agent-1', {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    expect(enqueueExisting).toHaveBeenCalledWith('request-1', {
      instruction: 'Make it concise',
    });
    expect(result).toEqual({
      content: 'Targeted rewrite request "request-1" is queued (attempt 2).',
      state: {
        attempt: 2,
        errorCode: null,
        errorMessage: null,
        requestId: 'request-1',
        status: 'queued',
        updatedAt: '2026-08-29T00:00:00.000Z',
      },
    });
    expect(JSON.stringify(result)).not.toContain('snapshot');
  });

  it('rejects nodeKey, room ticket, selection, and snapshot smuggling before lookup', async () => {
    const findById = vi.fn();
    const service = createPageAgentRewriteSelectionService({
      db: {} as never,
      requestService: { enqueueExisting: vi.fn(), findById } as never,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    await expect(
      service(
        {
          nodeKey: 'lexical-key',
          requestId: 'request-1',
          roomTicket: 'secret',
          snapshot: { content: 'body' },
        } as never,
        context,
      ),
    ).rejects.toThrow('DOCUMENT_REWRITE_REQUEST_INVALID');
    expect(findById).not.toHaveBeenCalled();
    expect(mocks.documentAccess).not.toHaveBeenCalled();
    expect(mocks.agentAccess).not.toHaveBeenCalled();
  });

  it('denies a request bound to another document or agent without enqueueing', async () => {
    const findById = vi.fn().mockResolvedValue(request({ agentId: 'other-agent' }));
    const enqueueExisting = vi.fn();
    const service = createPageAgentRewriteSelectionService({
      db: {} as never,
      requestService: { enqueueExisting, findById } as never,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    await expect(service({ requestId: 'request-1' }, context)).rejects.toThrow('agentId mismatch');
    expect(enqueueExisting).not.toHaveBeenCalled();
    expect(mocks.documentAccess).not.toHaveBeenCalled();
  });

  it('rechecks personal document ownership when no workspace is present', async () => {
    const findById = vi.fn().mockResolvedValue(request({ workspaceId: null }));
    const enqueueExisting = vi.fn().mockResolvedValue({
      isDuplicate: true,
      request: request({ status: 'thinking', workspaceId: null }),
    });
    const service = createPageAgentRewriteSelectionService({
      db: {} as never,
      requestService: { enqueueExisting, findById } as never,
      userId: 'user-1',
    });

    const result = await service({ requestId: 'request-1' }, { ...context, workspaceId: null });

    expect(mocks.documentFindById).toHaveBeenCalledWith('document-1');
    expect(mocks.documentAccess).not.toHaveBeenCalled();
    expect(result.state).toMatchObject({ status: 'thinking', requestId: 'request-1' });
  });
});
