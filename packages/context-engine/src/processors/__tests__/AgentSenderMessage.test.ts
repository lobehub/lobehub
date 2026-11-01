import { describe, expect, it } from 'vitest';

import { AgentSenderMessageProcessor } from '../AgentSenderMessage';

const createContext = (messages: any[]) => ({
  initialState: {
    messages: [],
    model: 'gpt-4',
    provider: 'openai',
    systemRole: '',
    tools: [],
  },
  isAborted: false,
  messages,
  metadata: {
    maxTokens: 4096,
    model: 'gpt-4',
  },
});

const message = (id: string, role: string, content: any, metadata?: Record<string, unknown>) => ({
  content,
  createdAt: 1,
  id,
  role,
  updatedAt: 1,
  ...(metadata ? { metadata } : {}),
});

describe('AgentSenderMessageProcessor', () => {
  it('tells the model who sent the message and how to reply to it', async () => {
    const result = await new AgentSenderMessageProcessor({ canRunLhCommand: true }).process(
      createContext([
        message('msg_1', 'user', 'Please iterate the verifier.', {
          agentSender: { agentId: 'agt_a', hop: 1, name: 'Writer "W"', topicId: 'tpc_src' },
        }),
      ]),
    );

    expect(result.messages[0].content).toBe(
      '<agent_sender name="Writer &quot;W&quot;" agent_id="agt_a" topic_id="tpc_src" message_id="msg_1">' +
        'Sent by another agent, not typed by the user. To answer that agent, run ' +
        '`lh message reply msg_1 -c "<your reply>"`: the reply wakes its conversation. ' +
        'Your own response here is not delivered to it.</agent_sender>\n\nPlease iterate the verifier.',
    );
    expect(result.metadata.agentSenderMessagesProcessed).toBe(1);
  });

  // ROOT CAUSE:
  //
  // The header told every receiving agent to run `lh message reply`, including
  // one in chat mode or with a custom tool set that has no way to run a
  // command — the report-back it promised could never happen.
  //
  // Before: the command was offered unconditionally.
  // After: only with a tool that can run `lh`; otherwise relay via the user.
  it('keeps the attribution but asks for a relay when the agent cannot run commands', async () => {
    const result = await new AgentSenderMessageProcessor().process(
      createContext([
        message('msg_1', 'user', 'hi', {
          agentSender: { agentId: 'agt_a', name: 'Writer', topicId: 'tpc_src' },
        }),
      ]),
    );

    const content = result.messages[0].content as string;
    expect(content).toContain('name="Writer" agent_id="agt_a" topic_id="tpc_src"');
    expect(content).not.toContain('lh message reply');
    expect(content).toContain('tell the user so they can pass it on');
  });

  it('offers no reply when the origin was not kept', async () => {
    const result = await new AgentSenderMessageProcessor({ canRunLhCommand: true }).process(
      createContext([message('msg_1', 'user', 'hi', { agentSender: { agentId: 'agt_a' } })]),
    );

    expect(result.messages[0].content).not.toContain('lh message reply');
    expect(result.messages[0].content).toContain('agent_id="agt_a"');
  });

  it('leaves messages a person wrote, and non-user messages, untouched', async () => {
    const messages = [
      message('msg_1', 'user', 'typed by a person'),
      message('msg_2', 'assistant', 'answer', { agentSender: { agentId: 'agt_a' } }),
      message('msg_3', 'user', [{ text: 'already parts', type: 'text' }], {
        agentSender: { agentId: 'agt_a' },
      }),
    ];

    const result = await new AgentSenderMessageProcessor().process(createContext(messages));

    expect(result.messages.map((m: any) => m.content)).toEqual(messages.map((m) => m.content));
    expect(result.metadata.agentSenderMessagesProcessed).toBe(0);
  });
});
