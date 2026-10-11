import { describe, expect, it } from 'vitest';

import { buildFlatToolsOrder, FLAT_ROW_STATE_LABEL_KEY } from './toolsViewLayout';

interface Row {
  id: string;
}

const row = (id: string): Row => ({ id });

describe('buildFlatToolsOrder', () => {
  const agentSkill = (item: Row) => item.id.startsWith('agent-skill');

  it('places app-managed rows first, then Agent Skills, the capabilities, and the rest', () => {
    const result = buildFlatToolsOrder({
      capabilityItems: [row('lobe-user-memory'), row('lobe-web-browsing')],
      fixedItems: [row('lobe-agent'), row('lobe-skills')],
      isAgentSkillItem: agentSkill,
      skillItems: [row('agent-skill-artifacts'), row('lobe-task'), row('notion')],
    });

    expect(result.map((item) => item.id)).toEqual([
      'lobe-agent',
      'lobe-skills',
      'agent-skill-artifacts',
      'lobe-user-memory',
      'lobe-web-browsing',
      'lobe-task',
      'notion',
    ]);
  });

  it('keeps every input row exactly once', () => {
    const skillItems = [row('a'), row('b'), row('agent-skill-c')];
    const result = buildFlatToolsOrder({
      capabilityItems: [row('cap')],
      fixedItems: [row('fixed')],
      isAgentSkillItem: agentSkill,
      skillItems,
    });

    expect(result).toHaveLength(5);
    expect(new Set(result.map((item) => item.id)).size).toBe(5);
  });

  it("is indifferent to a row's activation state", () => {
    const withState = (id: string, state: string) => ({ id, state });
    const input = (state: string) => ({
      capabilityItems: [withState('cap', state)],
      fixedItems: [withState('fixed', state)],
      isAgentSkillItem: agentSkill,
      skillItems: [withState('agent-skill-a', state), withState('rest', state)],
    });

    const enabled = buildFlatToolsOrder(input('auto')).map((item) => item.id);

    expect(buildFlatToolsOrder(input('disabled')).map((item) => item.id)).toEqual(enabled);
    expect(buildFlatToolsOrder(input('pinned')).map((item) => item.id)).toEqual(enabled);
  });
});

describe('FLAT_ROW_STATE_LABEL_KEY', () => {
  it('uses the state nouns already shipped for the grouped headers', () => {
    expect(FLAT_ROW_STATE_LABEL_KEY).toEqual({
      auto: 'tools.activation.auto',
      disabled: 'tools.activation.disabled',
      pinned: 'tools.activation.pinned',
    });
  });
});
