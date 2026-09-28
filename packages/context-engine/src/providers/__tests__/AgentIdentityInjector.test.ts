import { describe, expect, it } from 'vitest';

import { AgentIdentityInjector } from '../AgentIdentityInjector';

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

const systemMessage = {
  content: 'You are a helpful assistant.',
  createdAt: Date.now(),
  id: 'system-1',
  role: 'system',
  updatedAt: Date.now(),
};

const userMessage = {
  content: '你是谁?',
  createdAt: Date.now(),
  id: '1',
  role: 'user',
  updatedAt: Date.now(),
};

describe('AgentIdentityInjector', () => {
  it('appends the agent name and title to the existing system message', async () => {
    const provider = new AgentIdentityInjector({
      identity: { name: '芙莉莲', title: '魔法使' },
    });

    const result = await provider.process(createContext([systemMessage, userMessage]) as any);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toContain('You are a helpful assistant.');
    expect(result.messages[0].content).toContain('<agent_identity>');
    expect(result.messages[0].content).toContain('<name>芙莉莲</name>');
    expect(result.messages[0].content).toContain('<title>魔法使</title>');
    expect(result.metadata.agentIdentityInjected).toBe(true);
  });

  it('creates a system message when none exists', async () => {
    const provider = new AgentIdentityInjector({ identity: { name: '芙莉莲' } });

    const result = await provider.process(createContext([userMessage]) as any);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toContain('<name>芙莉莲</name>');
    expect(result.messages[0].content).not.toContain('<title>');
  });

  it('skips when the agent has neither name nor title', async () => {
    const provider = new AgentIdentityInjector({ identity: { name: '  ', title: undefined } });

    const result = await provider.process(createContext([systemMessage, userMessage]) as any);

    expect(result.messages[0].content).toBe('You are a helpful assistant.');
    expect(result.metadata.agentIdentityInjected).toBeUndefined();
  });

  it('skips when disabled (group chat owns identity there)', async () => {
    const provider = new AgentIdentityInjector({
      enabled: false,
      identity: { name: '芙莉莲', title: '魔法使' },
    });

    const result = await provider.process(createContext([systemMessage, userMessage]) as any);

    expect(result.messages[0].content).toBe('You are a helpful assistant.');
    expect(result.metadata.agentIdentityInjected).toBeUndefined();
  });
});
