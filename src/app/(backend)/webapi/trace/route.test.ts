// @vitest-environment node
import { TraceEventType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const mocks = vi.hoisted(() => ({
  enabled: true,
  flush: vi.fn(),
  scheduled: [] as (() => Promise<void>)[],
  record: vi.fn(),
}));
vi.mock('next/server', () => ({
  after: (work: () => Promise<void>) => mocks.scheduled.push(work),
}));
vi.mock('@/libs/traces', () => ({
  getLangfuseClient: () => (mocks.enabled ? {} : undefined),
  flushTraces: mocks.flush,
}));
vi.mock('@/libs/traces/event', () => ({
  TraceEventClient: class {
    copyMessage = mocks.record;
    modifyMessage = mocks.record;
    regenerateMessage = mocks.record;
    deleteAndRegenerateMessage = mocks.record;
  },
}));

beforeEach(() => {
  mocks.enabled = true;
  mocks.scheduled = [];
  vi.clearAllMocks();
  mocks.record.mockResolvedValue(undefined);
});

describe('feedback route', () => {
  it.each(Object.values(TraceEventType))(
    'awaits %s before scheduling the export flush',
    async (eventType) => {
      let complete!: () => void;
      mocks.record.mockReturnValue(
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
      );
      const data = {
        eventType,
        traceId: 'legacy-id',
        observationId: 'legacy-observation',
        content: 'before',
        nextContent: 'after',
        userId: 'user-1',
        sessionId: 'session-1',
      };
      const response = POST(
        new Request('http://localhost/webapi/trace', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      );
      await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledWith(data));
      expect(mocks.scheduled).toHaveLength(0);
      complete();
      expect((await response).status).toBe(201);
      expect(mocks.scheduled).toHaveLength(1);
      await mocks.scheduled[0]();
      expect(mocks.flush).toHaveBeenCalledTimes(1);
    },
  );

  it('does not record feedback when Langfuse is disabled', async () => {
    mocks.enabled = false;
    const response = await POST(
      new Request('http://localhost/webapi/trace', {
        method: 'POST',
        body: JSON.stringify({
          eventType: TraceEventType.CopyMessage,
          traceId: 'legacy-id',
          content: 'hello',
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
