import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { BaseSystemRoleProvider } from '../BaseSystemRoleProvider';

const createContext = (messages: any[] = []): PipelineContext => ({
  initialState: { messages: [] },
  isAborted: false,
  messages: messages.map((m, i) => ({
    createdAt: Date.now(),
    id: `msg-${i}`,
    updatedAt: Date.now(),
    ...m,
  })),
  metadata: {},
});

class StringProvider extends BaseSystemRoleProvider {
  readonly name = 'StringProvider';
  constructor(private returnValue: any) {
    super();
  }
  protected buildSystemRoleContent(): any {
    return this.returnValue;
  }
}

describe('BaseSystemRoleProvider', () => {
  it('should inject string content into system message', async () => {
    const provider = new StringProvider('Hello system');
    const result = await provider.process(createContext([{ content: 'Hi', role: 'user' }]));

    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toBe('Hello system');
  });

  it('should skip when content is null', async () => {
    const provider = new StringProvider(null);
    const result = await provider.process(createContext([{ content: 'Hi', role: 'user' }]));

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
  });

  it('should skip when content is empty string', async () => {
    const provider = new StringProvider('');
    const result = await provider.process(createContext([{ content: 'Hi', role: 'user' }]));

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
  });

  it('should skip when content is whitespace-only string', async () => {
    const provider = new StringProvider('   \n  ');
    const result = await provider.process(createContext([{ content: 'Hi', role: 'user' }]));

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
  });

  it('should not throw when buildSystemRoleContent returns an object', async () => {
    const provider = new StringProvider({ some: 'object' });
    const result = await provider.process(createContext([{ content: 'Hi', role: 'user' }]));

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
  });

  it('should not throw when buildSystemRoleContent returns an array', async () => {
    const provider = new StringProvider(['a', 'b']);
    const result = await provider.process(createContext([{ content: 'Hi', role: 'user' }]));

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
  });

  it('should not throw when buildSystemRoleContent returns a number', async () => {
    const provider = new StringProvider(42);
    const result = await provider.process(createContext([{ content: 'Hi', role: 'user' }]));

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
  });

  it('should not throw when buildSystemRoleContent returns true', async () => {
    const provider = new StringProvider(true);
    const result = await provider.process(createContext([{ content: 'Hi', role: 'user' }]));

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
  });
});
