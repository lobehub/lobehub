import { describe, expect, it } from 'vitest';

import { ModelKnowledgeCutoffProvider } from '../ModelKnowledgeCutoffProvider';

const createContext = (messages: any[] = []) => ({
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

describe('ModelKnowledgeCutoffProvider', () => {
  it('should inject model knowledge cutoff', async () => {
    const provider = new ModelKnowledgeCutoffProvider({ knowledgeCutoff: '2024-06' });
    const context = createContext([
      { content: 'Hello', createdAt: Date.now(), id: '1', role: 'user', updatedAt: Date.now() },
    ]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toBe('Model knowledge cutoff: 2024-06');
    expect(result.metadata.modelKnowledgeCutoffInjected).toBe(true);
  });

  it('should append cutoff to existing system message', async () => {
    const provider = new ModelKnowledgeCutoffProvider({ knowledgeCutoff: '2024-06' });
    const context = createContext([
      {
        content: 'You are a helpful assistant.',
        createdAt: Date.now(),
        id: 'sys',
        role: 'system',
        updatedAt: Date.now(),
      },
      { content: 'Hello', createdAt: Date.now(), id: '1', role: 'user', updatedAt: Date.now() },
    ]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toBe(
      'You are a helpful assistant.\n\nModel knowledge cutoff: 2024-06',
    );
    expect(result.metadata.modelKnowledgeCutoffInjected).toBe(true);
  });

  it('should trim cutoff before injection', async () => {
    const provider = new ModelKnowledgeCutoffProvider({ knowledgeCutoff: '  2024-06  ' });
    const context = createContext([]);

    const result = await provider.process(context);

    expect(result.messages[0].content).toBe('Model knowledge cutoff: 2024-06');
  });

  it('should skip injection when cutoff is missing', async () => {
    const provider = new ModelKnowledgeCutoffProvider({});
    const context = createContext([
      { content: 'Hello', createdAt: Date.now(), id: '1', role: 'user', updatedAt: Date.now() },
    ]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(1);
    expect(result.metadata.modelKnowledgeCutoffInjected).toBeUndefined();
  });

  it('should skip injection when disabled', async () => {
    const provider = new ModelKnowledgeCutoffProvider({
      enabled: false,
      knowledgeCutoff: '2024-06',
    });
    const context = createContext([
      { content: 'Hello', createdAt: Date.now(), id: '1', role: 'user', updatedAt: Date.now() },
    ]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(1);
    expect(result.metadata.modelKnowledgeCutoffInjected).toBeUndefined();
  });
});
