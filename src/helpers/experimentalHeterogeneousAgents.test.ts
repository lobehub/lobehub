import { describe, expect, it } from 'vitest';

import {
  isExperimentalHeterogeneousAgentType,
  isHeterogeneousAgentTypeEnabled,
} from './experimentalHeterogeneousAgents';

describe('experimental heterogeneous agents', () => {
  it('treats MiniMax Code as experimental and off by default', () => {
    expect(isExperimentalHeterogeneousAgentType('minimax-code')).toBe(true);
    expect(isHeterogeneousAgentTypeEnabled('minimax-code')).toBe(false);
    expect(isHeterogeneousAgentTypeEnabled('minimax-code', { enableMinimaxCode: true })).toBe(true);
  });

  it('leaves stable providers enabled', () => {
    expect(isExperimentalHeterogeneousAgentType('claude-code')).toBe(false);
    expect(isHeterogeneousAgentTypeEnabled('claude-code')).toBe(true);
    expect(isHeterogeneousAgentTypeEnabled('trae')).toBe(true);
  });
});
