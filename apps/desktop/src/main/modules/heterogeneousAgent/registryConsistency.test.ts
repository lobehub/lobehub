import { HETEROGENEOUS_AGENT_CONFIGS, listLocalAgentTypes } from '@lobechat/heterogeneous-agents';
import { describe, expect, it, vi } from 'vitest';

import { SUPPORTED_HETEROGENEOUS_AGENT_TYPES } from '../../../../../../src/features/Electron/HeterogeneousAgent/StatusGuide/types';
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
    expect(SUPPORTED_HETEROGENEOUS_AGENT_TYPES.toSorted()).toEqual(descriptorTypes);
  });
});
