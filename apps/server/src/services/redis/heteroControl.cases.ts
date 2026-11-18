import { afterEach, expect, it, vi } from 'vitest';

import type { heteroControl as HeteroControl, HeteroControlMessage } from './heteroControl';

/**
 * The control queue's behaviour, shared by the in-memory run
 * (`heteroControl.test.ts`) and the real-Redis run of the Lua scripts
 * (`heteroControl.realRedis.test.ts`), so the emulation cannot drift from them.
 */
export const defineHeteroControlCases = (getQueue: () => typeof HeteroControl) => {
  let run = 0;
  // A fresh operation per case keeps a real Redis free of cross-case state.
  const nextOp = () => `op-${Date.now()}-${++run}`;
  const message = (id: string, command = 'test_command'): HeteroControlMessage => ({
    command,
    createdAt: 1,
    id,
    params: { taskId: 't-1' },
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hands queued messages out oldest first, then nothing', async () => {
    const queue = getQueue();
    const op = nextOp();
    const expiresAt = Date.now() + 60_000;
    await queue.enqueue(op, message('c1'), expiresAt);
    await queue.enqueue(op, message('c2', 'other'), expiresAt);

    expect(await queue.read(op, 'c1')).toEqual({ status: 'pending' });
    expect(await queue.claim(op)).toEqual(message('c1'));
    expect(await queue.claim(op)).toEqual(message('c2', 'other'));
    expect(await queue.claim(op)).toBeUndefined();
  });

  it('claims a message at most once', async () => {
    const queue = getQueue();
    const op = nextOp();
    await queue.enqueue(op, message('c1'), Date.now() + 60_000);

    const claims = await Promise.all([queue.claim(op), queue.claim(op), queue.claim(op)]);
    expect(claims.filter(Boolean)).toEqual([message('c1')]);
    expect(await queue.read(op, 'c1')).toEqual({ status: 'claimed' });
    // A run that dies holding it never gets it handed out again.
    expect(await queue.claim(op)).toBeUndefined();
  });

  it('keeps queues apart per operation', async () => {
    const queue = getQueue();
    const op = nextOp();
    const other = nextOp();
    await queue.enqueue(op, message('c1'), Date.now() + 60_000);

    expect(await queue.claim(other)).toBeUndefined();
    expect(await queue.read(other, 'c1')).toBeUndefined();
    expect(await queue.claim(op)).toEqual(message('c1'));
  });

  it('expires a message nobody claimed in time', async () => {
    const queue = getQueue();
    const op = nextOp();
    const now = Date.now();
    await queue.enqueue(op, message('c1'), now + 1000);
    await queue.enqueue(op, message('c2'), now + 60_000);

    vi.spyOn(Date, 'now').mockReturnValue(now + 1000);
    expect(await queue.read(op, 'c1')).toEqual({ status: 'expired' });
    // Expired on read, so the claim skips it for the next one.
    expect(await queue.claim(op)).toEqual(message('c2'));
    expect(await queue.read(op, 'c1')).toEqual({ status: 'expired' });
  });

  it('drops an expired message on claim', async () => {
    const queue = getQueue();
    const op = nextOp();
    const now = Date.now();
    await queue.enqueue(op, message('c1'), now + 1000);

    vi.spyOn(Date, 'now').mockReturnValue(now + 5000);
    expect(await queue.claim(op)).toBeUndefined();
    expect(await queue.read(op, 'c1')).toEqual({ status: 'expired' });
    expect(await queue.report(op, 'c1', { status: 'ok' })).toBe('expired');
  });

  it('keeps a claimed message claimed past its expiry', async () => {
    const queue = getQueue();
    const op = nextOp();
    const now = Date.now();
    await queue.enqueue(op, message('c1'), now + 1000);
    await queue.claim(op);

    vi.spyOn(Date, 'now').mockReturnValue(now + 5000);
    expect(await queue.read(op, 'c1')).toEqual({ status: 'claimed' });
  });

  it('records the first report of a claimed message only', async () => {
    const queue = getQueue();
    const op = nextOp();
    const expiresAt = Date.now() + 60_000;
    await queue.enqueue(op, message('c1'), expiresAt);
    await queue.enqueue(op, message('c2'), expiresAt);
    await queue.enqueue(op, message('c3'), expiresAt);
    await queue.enqueue(op, message('c4'), expiresAt);

    // Not claimed yet: a report cannot settle it.
    expect(await queue.report(op, 'c1', { status: 'ok' })).toBe('pending');

    for (let i = 0; i < 4; i++) await queue.claim(op);
    expect(await queue.report(op, 'c1', { data: { stopped: true }, status: 'ok' })).toBe(
      'recorded',
    );
    expect(await queue.report(op, 'c2', { status: 'unsupported' })).toBe('recorded');
    expect(await queue.report(op, 'c3', { error: 'boom', status: 'error' })).toBe('recorded');
    expect(await queue.report(op, 'c1', { error: 'late', status: 'error' })).toBe('ok');
    expect(await queue.report(op, 'missing', { status: 'ok' })).toBe('absent');

    expect(await queue.read(op, 'c1')).toEqual({ data: { stopped: true }, status: 'ok' });
    expect(await queue.read(op, 'c2')).toEqual({ status: 'unsupported' });
    expect(await queue.read(op, 'c3')).toEqual({ error: 'boom', status: 'error' });
    expect(await queue.read(op, 'c4')).toEqual({ status: 'claimed' });
  });
};
