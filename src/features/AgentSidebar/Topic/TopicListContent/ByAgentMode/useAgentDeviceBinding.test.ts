/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadAgentDeviceBinding } from './useAgentDeviceBinding';

const mocks = vi.hoisted(() => ({ getAgentDeviceBindings: vi.fn() }));

vi.mock('@/services/device', () => ({
  deviceService: { getAgentDeviceBindings: mocks.getAgentDeviceBindings },
}));
vi.mock('@/libs/swr', () => ({ useClientDataSWR: vi.fn() }));
vi.mock('@/store/user', () => ({ useUserStore: vi.fn() }));
vi.mock('@/store/user/selectors', () => ({ authSelectors: { isLogin: vi.fn() } }));

describe('loadAgentDeviceBinding', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.getAgentDeviceBindings.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** @example A sidebar mounting a hundred agent groups makes one read, not a hundred. */
  it('coalesces agents asked for in the same tick into one server read', async () => {
    mocks.getAgentDeviceBindings.mockResolvedValue({ a: 'dev-1', b: 'dev-2' });

    const results = Promise.all([
      loadAgentDeviceBinding('a'),
      loadAgentDeviceBinding('b'),
      loadAgentDeviceBinding('c'),
    ]);
    await vi.runAllTimersAsync();

    expect(mocks.getAgentDeviceBindings).toHaveBeenCalledTimes(1);
    expect(mocks.getAgentDeviceBindings).toHaveBeenCalledWith(['a', 'b', 'c']);
    // An agent the server omits routes to no device.
    expect(await results).toEqual(['dev-1', 'dev-2', null]);
  });

  it('asks once for an agent requested twice in the same tick and answers both callers', async () => {
    mocks.getAgentDeviceBindings.mockResolvedValue({ a: 'dev-1' });

    const results = Promise.all([loadAgentDeviceBinding('a'), loadAgentDeviceBinding('a')]);
    await vi.runAllTimersAsync();

    expect(mocks.getAgentDeviceBindings).toHaveBeenCalledWith(['a']);
    expect(await results).toEqual(['dev-1', 'dev-1']);
  });

  it('starts a new read for agents asked for after the previous batch left', async () => {
    mocks.getAgentDeviceBindings.mockResolvedValue({});

    const first = loadAgentDeviceBinding('a');
    await vi.runAllTimersAsync();
    await first;
    const second = loadAgentDeviceBinding('b');
    await vi.runAllTimersAsync();
    await second;

    expect(mocks.getAgentDeviceBindings.mock.calls).toEqual([[['a']], [['b']]]);
  });

  it('rejects every waiter of a batch when the read fails', async () => {
    mocks.getAgentDeviceBindings.mockRejectedValue(new Error('boom'));

    const results = Promise.allSettled([loadAgentDeviceBinding('a'), loadAgentDeviceBinding('b')]);
    await vi.runAllTimersAsync();

    expect((await results).map((r) => r.status)).toEqual(['rejected', 'rejected']);
  });
});
