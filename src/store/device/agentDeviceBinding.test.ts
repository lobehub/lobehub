import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AGENT_DEVICE_BINDING_SWR_KEY, refreshAgentDeviceBindings } from './agentDeviceBinding';

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('@/libs/swr', () => ({ mutate: mocks.mutate }));

describe('refreshAgentDeviceBindings', () => {
  beforeEach(() => mocks.mutate.mockClear());

  it('revalidates only the cached agent device bindings, in every workspace context', () => {
    refreshAgentDeviceBindings();

    const matcher = mocks.mutate.mock.calls[0][0] as (key: unknown) => boolean;
    expect(matcher([AGENT_DEVICE_BINDING_SWR_KEY, 'agt_1', 'ws-1'])).toBe(true);
    expect(matcher([AGENT_DEVICE_BINDING_SWR_KEY, 'agt_2'])).toBe(true);
    expect(matcher(['device/listDevices'])).toBe(false);
    expect(matcher(AGENT_DEVICE_BINDING_SWR_KEY)).toBe(false);
  });
});
