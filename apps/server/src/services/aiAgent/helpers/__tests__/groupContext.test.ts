// @vitest-environment node
import { buildBotConversationGroupContext, buildGroupAgentContext } from '../groupContext';

describe('buildBotConversationGroupContext', () => {
  it('introduces the bot by its name with its title, since it replaces <agent_identity>', () => {
    const group = buildBotConversationGroupContext('agt_1', {
      description: 'Arvin 的分身',
      name: 'Nasa',
      title: 'Shadow Arvin',
    });

    expect(group.currentAgentName).toBe('Nasa (Shadow Arvin)');
    expect(group.members).toEqual([
      { id: 'agt_1', name: 'Nasa (Shadow Arvin)', role: 'participant' },
    ]);
    expect(group.systemPrompt).toBe('Arvin 的分身');
  });

  it('keeps the title for an agent without a name, and a placeholder for neither', () => {
    expect(
      buildBotConversationGroupContext('agt_1', { title: 'Shadow Arvin' }).currentAgentName,
    ).toBe('Shadow Arvin');
    expect(buildBotConversationGroupContext('agt_1', {}).currentAgentName).toBe('Current Agent');
  });
});

describe('buildGroupAgentContext', () => {
  it('names every member by name and role, and marks the responding one', () => {
    const group = buildGroupAgentContext('agt_2', { title: 'Team' }, [
      { agentId: 'agt_1', name: null, role: 'supervisor', title: 'Lead' },
      { agentId: 'agt_2', name: 'Nasa', role: 'participant', title: 'Shadow Arvin' },
    ]);

    expect(group?.members).toEqual([
      { id: 'agt_1', name: 'Lead', role: 'supervisor' },
      { id: 'agt_2', name: 'Nasa (Shadow Arvin)', role: 'participant' },
    ]);
    expect(group?.currentAgentName).toBe('Nasa (Shadow Arvin)');
  });
});
