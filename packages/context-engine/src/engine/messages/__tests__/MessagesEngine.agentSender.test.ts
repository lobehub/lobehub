import { describe, expect, it } from 'vitest';

import type { UIChatMessage } from '@/types/index';

import { MessagesEngine } from '../MessagesEngine';
import type { MessagesEngineParams } from '../types';

const agentSentMessages = (): UIChatMessage[] => [
  {
    content: 'Please iterate the verifier.',
    createdAt: 1,
    id: 'msg_from_writer',
    metadata: { agentSender: { agentId: 'agt_writer', name: 'Writer', topicId: 'tpc_writer' } },
    role: 'user',
    updatedAt: 1,
  } as UIChatMessage,
];

const userContent = async (overrides: Partial<MessagesEngineParams>) => {
  const engine = new MessagesEngine({
    enableSystemDate: false,
    messages: agentSentMessages(),
    model: 'gpt-4',
    provider: 'openai',
    ...overrides,
  });
  const result = await engine.process();
  // Injectors may add user messages of their own (e.g. available tools); read the sent one.
  return result.messages
    .filter((message) => message.role === 'user')
    .map((message) =>
      typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
    )
    .find((content) => content.includes('Please iterate the verifier.'));
};

describe('MessagesEngine — agent-sent messages', () => {
  it('offers `lh message reply` when the agent can activate a command tool', async () => {
    const content = await userContent({
      toolDiscoveryConfig: {
        availableTools: [
          { description: 'Run shell commands', identifier: 'lobe-local-system', name: 'Local' },
        ],
      },
    });

    expect(content).toContain('<agent_sender name="Writer"');
    expect(content).toContain('lh message reply msg_from_writer');
  });

  it('asks for a relay through the user when no tool can run commands', async () => {
    const content = await userContent({});

    expect(content).toContain('<agent_sender name="Writer"');
    expect(content).not.toContain('lh message reply');
  });
});
