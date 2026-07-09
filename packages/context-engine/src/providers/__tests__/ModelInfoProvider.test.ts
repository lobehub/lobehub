import { describe, expect, it } from 'vitest';

import { ModelInfoProvider } from '../ModelInfoProvider';

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

describe('ModelInfoProvider', () => {
  it('should inject model name, id and knowledge cutoff', async () => {
    const provider = new ModelInfoProvider({
      displayName: 'Fable 5',
      knowledgeCutoff: '2024-06',
      modelId: 'claude-fable-5',
    });
    const context = createContext([
      { content: 'Hello', createdAt: Date.now(), id: '1', role: 'user', updatedAt: Date.now() },
    ]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toBe(
      'Current model: Fable 5 (claude-fable-5)\nModel knowledge cutoff: 2024-06',
    );
    expect(result.metadata.modelInfoInjected).toBe(true);
  });

  it('should skip the model line when displayName is missing (bare id only)', async () => {
    const provider = new ModelInfoProvider({ modelId: 'claude-fable-5' });
    const context = createContext([
      { content: 'Hello', createdAt: Date.now(), id: '1', role: 'user', updatedAt: Date.now() },
    ]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(1);
    expect(result.metadata.modelInfoInjected).toBeUndefined();
  });

  it('should not duplicate when displayName equals model id', async () => {
    const provider = new ModelInfoProvider({ displayName: 'gpt-4o', modelId: 'gpt-4o' });
    const context = createContext([]);

    const result = await provider.process(context);

    expect(result.messages[0].content).toBe('Current model: gpt-4o');
  });

  it('should inject only knowledge cutoff when model info is absent', async () => {
    const provider = new ModelInfoProvider({ knowledgeCutoff: '2024-06' });
    const context = createContext([]);

    const result = await provider.process(context);

    expect(result.messages[0].content).toBe('Model knowledge cutoff: 2024-06');
    expect(result.metadata.modelInfoInjected).toBe(true);
  });

  it('should append info to existing system message', async () => {
    const provider = new ModelInfoProvider({
      displayName: 'GPT-4o',
      knowledgeCutoff: '2024-06',
      modelId: 'gpt-4o',
    });
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
      'You are a helpful assistant.\n\nCurrent model: GPT-4o (gpt-4o)\nModel knowledge cutoff: 2024-06',
    );
    expect(result.metadata.modelInfoInjected).toBe(true);
  });

  it('should trim values before injection', async () => {
    const provider = new ModelInfoProvider({
      displayName: '  Fable 5  ',
      knowledgeCutoff: '  2024-06  ',
      modelId: '  claude-fable-5  ',
    });
    const context = createContext([]);

    const result = await provider.process(context);

    expect(result.messages[0].content).toBe(
      'Current model: Fable 5 (claude-fable-5)\nModel knowledge cutoff: 2024-06',
    );
  });

  it('should skip injection when nothing is configured', async () => {
    const provider = new ModelInfoProvider({});
    const context = createContext([
      { content: 'Hello', createdAt: Date.now(), id: '1', role: 'user', updatedAt: Date.now() },
    ]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(1);
    expect(result.metadata.modelInfoInjected).toBeUndefined();
  });

  it('should skip injection when disabled', async () => {
    const provider = new ModelInfoProvider({
      enabled: false,
      knowledgeCutoff: '2024-06',
      modelId: 'gpt-4o',
    });
    const context = createContext([
      { content: 'Hello', createdAt: Date.now(), id: '1', role: 'user', updatedAt: Date.now() },
    ]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(1);
    expect(result.metadata.modelInfoInjected).toBeUndefined();
  });
});
