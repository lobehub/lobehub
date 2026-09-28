// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resumeAbandonedParent } from '../resumeAbandonedParent';

const mockDeliverWebhook = vi.hoisted(() => vi.fn());
const mockCompleteSubAgentBridge = vi.hoisted(() => vi.fn());
const mockAiAgentService = vi.hoisted(() => vi.fn());

vi.mock('@/server/services/agentRuntime/hooks/HookDispatcher', () => ({
  deliverWebhook: mockDeliverWebhook,
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function (...args: any[]) {
    mockAiAgentService(...args);
    return { completeSubAgentBridge: mockCompleteSubAgentBridge };
  }),
}));

const resume = {
  errorMessage: 'abandoned',
  parentOperationId: 'op-parent',
  streamOwnerUserId: 'visitor-1',
  threadId: 'thd-1',
  toolMessageId: 'msg-tool',
  userId: 'user-1',
  workspaceId: 'ws-1',
};
const bridgeBody = {
  errorMessage: 'abandoned',
  operationId: 'op-child',
  parentOperationId: 'op-parent',
  reason: 'error',
  threadId: 'thd-1',
  toolMessageId: 'msg-tool',
};

describe('resumeAbandonedParent', () => {
  const db = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('queues the durable callback with the visitor marker in queue mode', async () => {
    // The callback may find the child's metadata gone (runStep orphan
    // recovery), so the marker must ride along in the body.
    vi.stubEnv('QSTASH_TOKEN', 'token');

    await resumeAbandonedParent(db, 'op-child', resume);

    expect(mockDeliverWebhook).toHaveBeenCalledWith(
      { delivery: 'qstash', fallback: 'none', url: '/api/agent/webhooks/subagent-callback' },
      { ...bridgeBody, streamOwnerUserId: 'visitor-1' },
    );
    expect(mockCompleteSubAgentBridge).not.toHaveBeenCalled();
  });

  it('runs the bridge inline without a queue', async () => {
    vi.stubEnv('QSTASH_TOKEN', '');

    await resumeAbandonedParent(db, 'op-child', resume);

    expect(mockDeliverWebhook).not.toHaveBeenCalled();
    expect(mockAiAgentService).toHaveBeenCalledWith(db, 'user-1', {
      includeShareVisitor: true,
      workspaceId: 'ws-1',
    });
    expect(mockCompleteSubAgentBridge).toHaveBeenCalledWith(bridgeBody);
  });
});
