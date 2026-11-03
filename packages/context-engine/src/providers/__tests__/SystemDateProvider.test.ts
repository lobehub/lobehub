import { describe, expect, it } from 'vitest';

import { SystemDateProvider } from '../SystemDateProvider';

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

describe('SystemDateProvider', () => {
  it('should inject current date with UTC timezone by default', async () => {
    const provider = new SystemDateProvider({});
    const context = createContext([
      { content: 'Hello', createdAt: Date.now(), id: '1', role: 'user', updatedAt: Date.now() },
    ]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toMatch(/^Current date: \d{4}-\d{2}-\d{2} \(UTC\)$/);
    expect(result.metadata.systemDateInjected).toBe(true);
  });

  it('should include timezone name when timezone is provided', async () => {
    const provider = new SystemDateProvider({ timezone: 'Asia/Shanghai' });
    const context = createContext([
      { content: 'Hello', createdAt: Date.now(), id: '1', role: 'user', updatedAt: Date.now() },
    ]);

    const result = await provider.process(context);

    expect(result.messages[0].content).toMatch(
      /^Current date: \d{4}-\d{2}-\d{2} \(Asia\/Shanghai\)$/,
    );
  });

  it('should fallback to UTC when timezone is null', async () => {
    const provider = new SystemDateProvider({ timezone: null });
    const context = createContext([
      { content: 'Hello', createdAt: Date.now(), id: '1', role: 'user', updatedAt: Date.now() },
    ]);

    const result = await provider.process(context);

    expect(result.messages[0].content).toMatch(/\(UTC\)$/);
  });

  it('should append date to existing system message', async () => {
    const provider = new SystemDateProvider({ timezone: 'America/New_York' });
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
    expect(result.messages[0].content).toMatch(
      /^You are a helpful assistant\.\n\nCurrent date: \d{4}-\d{2}-\d{2} \(America\/New_York\)$/,
    );
  });

  it('should skip injection when disabled', async () => {
    const provider = new SystemDateProvider({ enabled: false });
    const context = createContext([
      { content: 'Hello', createdAt: Date.now(), id: '1', role: 'user', updatedAt: Date.now() },
    ]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(1);
    expect(result.metadata.systemDateInjected).toBeUndefined();
  });

  it('should create system message when no messages exist', async () => {
    const provider = new SystemDateProvider({ timezone: 'Europe/London' });
    const context = createContext([]);

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toMatch(
      /^Current date: \d{4}-\d{2}-\d{2} \(Europe\/London\)$/,
    );
  });
});
