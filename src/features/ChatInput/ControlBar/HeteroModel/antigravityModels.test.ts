import { describe, expect, it } from 'vitest';

import { groupAntigravityModels } from './antigravityModels';

const row = (id: string, label: string) => ({ id, label, modelId: id, providerId: 'antigravity' });

describe('Antigravity model options', () => {
  it('groups recognized tiers without merging native model names with parentheses or effort-like IDs', () => {
    const carbon = row('gemini-pro-orchestrator', 'Orchestrator (Carbon)');
    const custom = row('custom-low', 'Custom low latency');
    expect(
      groupAntigravityModels([
        row('gemini-4-argon-high', 'Gemini 4 Argon (High)'),
        carbon,
        row('gemini-4-argon', 'Gemini 4 Argon'),
        row('gemini-4-argon-low', 'Gemini 4 Argon (Low)'),
        row('gemini-4-argon-medium', 'Gemini 4 Argon (Medium)'),
        custom,
      ]),
    ).toEqual([
      { ...row('gemini-4-argon', 'Gemini 4 Argon'), effortLevels: ['low', 'medium', 'high'] },
      carbon,
      custom,
    ]);
  });
});
