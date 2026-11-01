import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { refreshAgentDeviceBindings } from '@/store/device/agentDeviceBinding';

import { useAgentStore } from '../../store';

vi.mock('@/services/agent', () => ({
  AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT: 12,
  agentService: {
    updateAgentConfig: vi.fn(),
  },
}));

vi.mock('@/store/device/agentDeviceBinding', () => ({ refreshAgentDeviceBindings: vi.fn() }));

describe('updateAgentConfigById device binding cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(agentService.updateAgentConfig).mockResolvedValue({ success: true } as any);
    useAgentStore.setState({ agentMap: { 'agent-1': { agencyConfig: {} } } });
  });

  /** @example Moving an agent from one device to the cloud sandbox must update its sidebar dot. */
  it('refreshes the cached device bindings after an agency config write settles', async () => {
    await useAgentStore
      .getState()
      .updateAgentConfigById('agent-1', { agencyConfig: { executionTarget: 'sandbox' } });

    expect(agentService.updateAgentConfig).toHaveBeenCalled();
    expect(refreshAgentDeviceBindings).toHaveBeenCalledTimes(1);
  });

  it('leaves the cached device bindings alone for a write that does not touch routing', async () => {
    await useAgentStore.getState().updateAgentConfigById('agent-1', { model: 'model-a' });

    expect(agentService.updateAgentConfig).toHaveBeenCalled();
    expect(refreshAgentDeviceBindings).not.toHaveBeenCalled();
  });
});
