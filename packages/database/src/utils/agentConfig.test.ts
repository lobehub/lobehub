import { describe, expect, it } from 'vitest';

import { getUserDefaultAgentLayer, mergeAgentDefaultConfig } from './agentConfig';

describe('getUserDefaultAgentLayer', () => {
  it('drops the retired global Gateway Mode opt-out and keeps the rest', () => {
    expect(
      getUserDefaultAgentLayer({
        config: { chatConfig: { disableGatewayMode: true, searchMode: 'off' }, model: 'm' },
      }),
    ).toEqual({ chatConfig: { searchMode: 'off' }, model: 'm' });
  });

  it('returns an empty layer when the user has no default agent config', () => {
    expect(getUserDefaultAgentLayer(undefined)).toEqual({});
    expect(getUserDefaultAgentLayer({})).toEqual({});
  });
});

describe('mergeAgentDefaultConfig', () => {
  const userDefault = { config: { chatConfig: { disableGatewayMode: true } } };

  it('does not apply a personal Gateway Mode opt-out to an agent that never set one', () => {
    const merged = mergeAgentDefaultConfig({ id: 'agent' }, { userDefault });

    expect(merged.chatConfig?.disableGatewayMode).toBeUndefined();
  });

  it("keeps the agent's own Gateway Mode value", () => {
    const merged = mergeAgentDefaultConfig(
      { chatConfig: { disableGatewayMode: true }, id: 'agent' },
      { userDefault: { config: { chatConfig: { disableGatewayMode: false } } } },
    );

    expect(merged.chatConfig?.disableGatewayMode).toBe(true);
  });
});
