import { describe, expect, it } from 'vitest';

import type { UIChatMessage } from '@/types/index';

import { MessagesEngine } from '../MessagesEngine';
import type { MessagesEngineParams } from '../types';

const messages = (): UIChatMessage[] => [
  {
    content: 'Ask @Designer to draft a logo',
    createdAt: 1,
    id: 'msg_user',
    role: 'user',
    updatedAt: 1,
  } as UIChatMessage,
];

const process = async (overrides: Partial<MessagesEngineParams>) => {
  const engine = new MessagesEngine({
    enableSystemDate: false,
    messages: messages(),
    model: 'gpt-4',
    provider: 'openai',
    ...overrides,
  });
  const result = await engine.process();
  return result.messages
    .map((message) =>
      typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
    )
    .join('\n');
};

const agentManagementContext = {
  availableAgents: [{ id: 'agt_writer', title: 'Writer' }],
  currentAgent: { id: 'agt_self', title: 'Me' },
  mentionedAgents: [{ id: 'agt_designer', name: 'Designer' }],
};

describe('MessagesEngine — @mentioned agent delegation', () => {
  it('tells the model to delegate through callSubAgent with agentId', async () => {
    const payload = await process({ agentManagementContext });

    expect(payload).toContain('<mentioned_agents>');
    expect(payload).toContain('lobe-agent____callSubAgent');
    expect(payload).not.toContain('lobe-agent-management____callAgent');
  });

  // Chat mode offers the delegation-only lobe-agent, so the mention must still
  // reach the model; the rest of the agent-management context stays out.
  it('keeps only the mentioned agents in chat mode', async () => {
    const payload = await process({ agentManagementContext, enableAgentMode: false });

    expect(payload).toContain('<mentioned_agents>');
    expect(payload).toContain('agt_designer');
    expect(payload).not.toContain('agt_writer');
    expect(payload).not.toContain('<current_agent');
  });

  it('injects nothing in chat mode without a mention', async () => {
    const payload = await process({
      agentManagementContext: { ...agentManagementContext, mentionedAgents: undefined },
      enableAgentMode: false,
    });

    expect(payload).not.toContain('<mentioned_agents>');
    expect(payload).not.toContain('agt_writer');
  });
});
