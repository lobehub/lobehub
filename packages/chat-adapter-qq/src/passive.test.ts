import { describe, expect, it } from 'vitest';

import { createMemoryQQPassiveStore, QQ_PASSIVE_LIMITS } from './passive';

const LIMITS = QQ_PASSIVE_LIMITS.group;
const AT = 1_700_000_000_000;

describe('QQ passive window', () => {
  it('hands out reply slots up to the per-message budget', async () => {
    const store = createMemoryQQPassiveStore();
    await store.open('app:thread', { at: AT, msgId: 'msg_1' });

    const seqs: number[] = [];
    for (let i = 0; i < LIMITS.maxReplies; i++) {
      const slot = await store.reserve('app:thread', LIMITS, AT + 1000);
      seqs.push(slot!.seq);
    }

    expect(seqs).toEqual([1, 2, 3, 4, 5]);
    expect(await store.reserve('app:thread', LIMITS, AT + 1000)).toBeNull();
  });

  it('carries the inbound message id on every slot', async () => {
    const store = createMemoryQQPassiveStore();
    await store.open('app:thread', { at: AT, eventId: 'evt_1', msgId: 'msg_1' });

    const slot = await store.reserve('app:thread', LIMITS, AT + 1000);

    expect(slot).toMatchObject({ eventId: 'evt_1', msgId: 'msg_1' });
  });

  it('closes the window once it has expired', async () => {
    const store = createMemoryQQPassiveStore();
    await store.open('app:thread', { at: AT, msgId: 'msg_1' });

    expect(await store.reserve('app:thread', LIMITS, AT + LIMITS.windowMs + 1)).toBeNull();
  });

  it('reopens with a fresh budget on the next inbound message', async () => {
    const store = createMemoryQQPassiveStore();
    await store.open('app:thread', { at: AT, msgId: 'msg_1' });
    for (let i = 0; i < LIMITS.maxReplies; i++) {
      await store.reserve('app:thread', LIMITS, AT + 1000);
    }

    await store.open('app:thread', { at: AT + 2000, msgId: 'msg_2' });
    const slot = await store.reserve('app:thread', LIMITS, AT + 3000);

    expect(slot).toMatchObject({ msgId: 'msg_2', seq: 1 });
  });

  it('keeps the replies already spent when the same message is redelivered', async () => {
    const store = createMemoryQQPassiveStore();
    await store.open('app:thread', { at: AT, msgId: 'msg_1' });
    await store.reserve('app:thread', LIMITS, AT + 1000);

    // QQ redelivers the webhook: its own window must survive.
    await store.open('app:thread', { at: AT + 2000, msgId: 'msg_1' });
    const slot = await store.reserve('app:thread', LIMITS, AT + 3000);

    expect(slot).toMatchObject({ msgId: 'msg_1', seq: 2 });
  });

  it('never hands out a slot for an unknown thread', async () => {
    const store = createMemoryQQPassiveStore();

    expect(await store.reserve('app:unknown', LIMITS, AT)).toBeNull();
  });

  it('puts a claimed text back when delivery failed, but never over a newer reply', async () => {
    const store = createMemoryQQPassiveStore();
    await store.savePending('app:thread', 'claimed');

    expect(await store.takePending('app:thread')).toBe('claimed');
    await store.restorePending('app:thread', 'claimed');

    expect(await store.takePending('app:thread')).toBe('claimed');

    // A newer answer was parked while the claimed one was in flight: keep the newer one.
    await store.savePending('app:thread', 'newer');
    await store.restorePending('app:thread', 'claimed');

    expect(await store.takePending('app:thread')).toBe('newer');
  });

  it('keeps only the newest deferred text and hands it over once', async () => {
    const store = createMemoryQQPassiveStore();
    await store.savePending('app:thread', 'first');
    await store.savePending('app:thread', 'second');

    expect(await store.takePending('app:thread')).toBe('second');
    expect(await store.takePending('app:thread')).toBeUndefined();
  });
});
