// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dropPageRooms } from '../notify';

const { env, scheduled } = vi.hoisted(() => ({
  env: {
    AGENT_GATEWAY_SERVICE_TOKEN: 'token',
    AGENT_GATEWAY_URL: 'https://gateway.test',
    ENABLE_PAGE_COLLAB: false,
    ENABLE_WORKSPACE_PAGE_COLLAB: true,
  },
  scheduled: [] as Promise<unknown>[],
}));

vi.mock('@/envs/app', () => ({ appEnv: env }));

vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  afterUnscoped: (work: () => Promise<unknown>) => {
    scheduled.push(work());
  },
}));

const settle = () => Promise.all(scheduled);

describe('dropPageRooms', () => {
  let answers: number[];
  let calls: { method?: string; url: string }[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    env.ENABLE_WORKSPACE_PAGE_COLLAB = true;
    scheduled.length = 0;
    answers = [];
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        calls.push({ method: init?.method, url: String(input) });
        return new Response(null, { status: answers.shift() ?? 200 });
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const run = async () => {
    const done = settle();
    await vi.runAllTimersAsync();
    await done;
  };

  it('tells the gateway to drop each page room after the response', async () => {
    dropPageRooms(['doc_1', 'doc_2']);
    await run();

    expect(calls).toEqual([
      { method: 'DELETE', url: 'https://gateway.test/api/documents/room?documentId=doc_1' },
      { method: 'DELETE', url: 'https://gateway.test/api/documents/room?documentId=doc_2' },
    ]);
  });

  it('retries a failed drop, then gives up without failing the caller', async () => {
    answers = [503, 503, 503, 503];

    dropPageRooms(['doc_1']);
    await run();

    expect(calls).toHaveLength(3);
  });

  it('stops retrying once the gateway accepts the drop', async () => {
    answers = [503, 200];

    dropPageRooms(['doc_1']);
    await run();

    expect(calls).toHaveLength(2);
  });

  it('does nothing without page collaboration', async () => {
    env.ENABLE_WORKSPACE_PAGE_COLLAB = false;

    dropPageRooms(['doc_1']);
    await run();

    expect(calls).toEqual([]);
  });
});
