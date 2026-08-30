import { describe, expect, it } from 'vitest';

import { HETEROGENEOUS_AGENT_MODEL_IDS, isHeterogeneousAgentModelId } from './heterogeneousAgent';

describe('isHeterogeneousAgentModelId', () => {
  it.each([...HETEROGENEOUS_AGENT_MODEL_IDS])('recognizes legacy model id %s', (model) => {
    expect(isHeterogeneousAgentModelId(model)).toBe(true);
  });

  it.each(['kimi-code', 'qoder'] as const)(
    'includes %s so its bare model routes as a heterogeneous agent',
    (model) => {
      expect(HETEROGENEOUS_AGENT_MODEL_IDS).toContain(model);
      expect(isHeterogeneousAgentModelId(model)).toBe(true);
    },
  );

  it('includes cursor so bare model: "cursor" routes as a heterogeneous agent', () => {
    expect(HETEROGENEOUS_AGENT_MODEL_IDS).toContain('cursor');
    expect(isHeterogeneousAgentModelId('cursor')).toBe(true);
  });

  it('rejects normal cloud model ids and empty values', () => {
    expect(isHeterogeneousAgentModelId('gpt-4o')).toBe(false);
    expect(isHeterogeneousAgentModelId('')).toBe(false);
    expect(isHeterogeneousAgentModelId(null)).toBe(false);
    expect(isHeterogeneousAgentModelId(undefined)).toBe(false);
  });
});
