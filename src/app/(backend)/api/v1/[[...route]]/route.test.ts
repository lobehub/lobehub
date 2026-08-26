import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const { mockInterruptTask, mockInterruptActiveShareRuns, mockFetch, AiAgentServiceCtor } =
  vi.hoisted(() => {
    const mockInterruptTask = vi.fn().mockResolvedValue({ success: true });
    const mockInterruptActiveShareRuns = vi.fn().mockResolvedValue(undefined);
    return {
      AiAgentServiceCtor: vi.fn(() => ({
        interruptActiveShareRuns: mockInterruptActiveShareRuns,
        interruptTask: mockInterruptTask,
      })),
      mockFetch: vi.fn(),
      mockInterruptActiveShareRuns,
      mockInterruptTask,
    };
  });

vi.mock('@lobechat/openapi', () => ({
  AGENT_SHARE_DELETE_SIGNAL_HEADER: 'x-lobehub-agent-share-delete',
  AGENT_SHARE_RESET_SIGNAL_HEADER: 'x-lobehub-agent-share-reset',
  default: { fetch: mockFetch },
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));

vi.mock('@/server/services/aiAgent', () => ({ AiAgentService: AiAgentServiceCtor }));

// Tests run `after()` eagerly so the interrupt side effect is observable
// without racing the assertion — same pattern as the lambda regression tests.
const afterTasks: Promise<unknown>[] = [];
vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  after: (work: () => Promise<unknown> | unknown) => {
    afterTasks.push(Promise.resolve(work()));
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  afterTasks.length = 0;
});

describe('agent share delete signal handling', () => {
  // Regression for LOBE-11930 / codex P1: `AgentController.deleteAgent`
  // signals in-flight visitor runs it snapshotted BEFORE the cascade via
  // `AGENT_SHARE_DELETE_SIGNAL_HEADER` (a JSON payload, unlike the sibling
  // reset signal, since re-querying `topics` post-delete would find
  // nothing). This is the one place that can read it and fire the interrupt.
  it('interrupts every snapshotted run and strips the header from the response', async () => {
    const payload = JSON.stringify({
      activeShareRuns: [
        { operationId: 'op-1', topicId: 'topic-1' },
        { operationId: 'op-2', topicId: 'topic-2' },
      ],
      ownerId: 'owner-1',
    });
    mockFetch.mockResolvedValue(
      new Response('{}', { headers: { 'x-lobehub-agent-share-delete': payload } }),
    );

    const response = await GET({} as never);
    await Promise.all(afterTasks);

    expect(response.headers.get('x-lobehub-agent-share-delete')).toBeNull();
    expect(AiAgentServiceCtor).toHaveBeenCalledWith(expect.anything(), 'owner-1');
    expect(mockInterruptTask).toHaveBeenCalledWith({ operationId: 'op-1' });
    expect(mockInterruptTask).toHaveBeenCalledWith({ operationId: 'op-2' });
    // Not the reset-signal helper — the delete path bypasses it on purpose,
    // see the JSDoc on `AGENT_SHARE_DELETE_SIGNAL_HEADER`.
    expect(mockInterruptActiveShareRuns).not.toHaveBeenCalled();
  });

  it('is a no-op when the response carries no delete signal', async () => {
    mockFetch.mockResolvedValue(new Response('{}'));

    const response = await GET({} as never);
    await Promise.all(afterTasks);

    expect(response.headers.get('x-lobehub-agent-share-delete')).toBeNull();
    expect(mockInterruptTask).not.toHaveBeenCalled();
  });

  it('fails closed on a malformed payload instead of throwing', async () => {
    mockFetch.mockResolvedValue(
      new Response('{}', { headers: { 'x-lobehub-agent-share-delete': 'not-json' } }),
    );

    const response = await GET({} as never);
    await Promise.all(afterTasks);

    expect(response.headers.get('x-lobehub-agent-share-delete')).toBeNull();
    expect(mockInterruptTask).not.toHaveBeenCalled();
  });
});
