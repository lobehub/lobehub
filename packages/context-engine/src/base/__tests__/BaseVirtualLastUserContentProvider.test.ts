import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { BaseVirtualLastUserContentProvider } from '../BaseVirtualLastUserContentProvider';

class TestVirtualLastUserContentProvider extends BaseVirtualLastUserContentProvider {
  readonly name = 'TestVirtualLastUserContentProvider';

  constructor(private readonly content: string | null = 'Virtual content') {
    super();
  }

  protected buildContent(): string | null {
    return this.content;
  }
}

describe('BaseVirtualLastUserContentProvider', () => {
  const createContext = (messages: any[] = []): PipelineContext => ({
    initialState: {
      messages: [],
      model: 'test-model',
      provider: 'test-provider',
    },
    isAborted: false,
    messages,
    metadata: {
      maxTokens: 4000,
      model: 'test-model',
    },
  });

  it('should append to the last message when it is a user message', async () => {
    const provider = new TestVirtualLastUserContentProvider();

    const result = await provider.process(
      createContext([
        { content: 'Hello', role: 'user' },
        { content: 'Keep going', role: 'user' },
      ]),
    );

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].content).toBe('Keep going\n\nVirtual content');
  });

  it('should create a synthetic tail user message when the last message is not user', async () => {
    const provider = new TestVirtualLastUserContentProvider();

    const result = await provider.process(
      createContext([
        { content: 'Hello', role: 'user' },
        { content: 'Tool result', role: 'tool' },
      ]),
    );

    expect(result.messages).toHaveLength(3);
    expect(result.messages[2]).toMatchObject({
      content: 'Virtual content',
      meta: {
        injectType: 'TestVirtualLastUserContentProvider',
        virtualLastUser: true,
      },
      role: 'user',
    });
  });

  it('should reuse an existing synthetic tail user message', async () => {
    const provider = new TestVirtualLastUserContentProvider('Second content');

    const result = await provider.process(
      createContext([
        { content: 'Hello', role: 'user' },
        {
          content: 'Virtual content',
          meta: { injectType: 'OtherProvider', virtualLastUser: true },
          role: 'user',
        },
      ]),
    );

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].content).toBe('Virtual content\n\nSecond content');
  });

  it('should skip when buildContent returns null', async () => {
    const provider = new TestVirtualLastUserContentProvider(null);

    const result = await provider.process(createContext([{ content: 'Hello', role: 'user' }]));

    expect(result.messages).toEqual([{ content: 'Hello', role: 'user' }]);
  });
});
