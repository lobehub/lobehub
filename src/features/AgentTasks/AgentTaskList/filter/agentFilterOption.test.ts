import { describe, expect, it } from 'vitest';

import AgentAvatar from '@/components/AgentAvatar';

import { toAgentFilterOption } from './agentFilterOption';

describe('toAgentFilterOption', () => {
  it('renders an agent without its own avatar through AgentAvatar, seeded by its id', () => {
    const option = toAgentFilterOption({ id: 'agt_coder', label: 'Coder Agent' });

    expect(option.icon.type).toBe(AgentAvatar);
    expect(option.icon.props).toMatchObject({ agentId: 'agt_coder', name: 'Coder Agent' });
    expect(option.value).toBe('agt_coder');
  });

  it('keeps the icon while overriding the value, as the creator field does', () => {
    const option = toAgentFilterOption(
      { avatar: '🤖', id: 'agt_coder', label: 'Coder Agent' },
      'agent:agt_coder',
    );

    expect(option.icon.props).toMatchObject({ agentId: 'agt_coder', avatar: '🤖' });
    expect(option.value).toBe('agent:agt_coder');
  });
});
