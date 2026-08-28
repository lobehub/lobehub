import { HETEROGENEOUS_AGENT_CONFIGS, listLocalAgentTypes } from '@lobechat/heterogeneous-agents';
import { describe, expect, it, vi } from 'vitest';

import { listHeterogeneousCliBinaryTypes } from '../binaries/cliAgentBinaries';
import { listHeterogeneousAgentDriverTypes } from '.';

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    verbose: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('heterogeneous agent registry consistency', () => {
  it('keeps every executable registry aligned with the descriptor catalog', () => {
    const descriptorTypes = HETEROGENEOUS_AGENT_CONFIGS.map(({ type }) => type).toSorted();

    expect(listLocalAgentTypes().toSorted()).toEqual(descriptorTypes);
    expect(listHeterogeneousAgentDriverTypes().toSorted()).toEqual(descriptorTypes);
    expect(listHeterogeneousCliBinaryTypes().toSorted()).toEqual(descriptorTypes);
  });
});
