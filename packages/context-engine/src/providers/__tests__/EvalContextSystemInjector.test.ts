import { describe, expect, it } from 'vitest';

import { EvalContextSystemInjector } from '../EvalContextSystemInjector';

describe('EvalContextSystemInjector', () => {
  it('should append envPrompt to existing system message', async () => {
    const provider = new EvalContextSystemInjector({
      enabled: true,
      evalContext: { envPrompt: 'You are in a test environment.' },
    });

    const context = {
      initialState: {
        messages: [],
        model: 'gpt-4',
        provider: 'openai',
        systemRole: '',
        tools: [],
      },
      isAborted: false,
      messages: [
        {
          content: 'You are a helpful assistant.',
          createdAt: Date.now(),
          id: 'system-1',
          role: 'system',
          updatedAt: Date.now(),
        },
        {
          content: 'Hello',
          createdAt: Date.now(),
          id: '1',
          role: 'user',
          updatedAt: Date.now(),
        },
      ],
      metadata: {
        maxTokens: 4096,
        model: 'gpt-4',
      },
    };

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toBe(
      'You are a helpful assistant.\n\nYou are in a test environment.',
    );
    expect(result.messages[0].role).toBe('system');
    expect(result.metadata.evalContextInjected).toBe(true);
  });

  it('should create new system message when none exists', async () => {
    const provider = new EvalContextSystemInjector({
      enabled: true,
      evalContext: { envPrompt: 'You are in a test environment.' },
    });

    const context = {
      initialState: {
        messages: [],
        model: 'gpt-4',
        provider: 'openai',
        systemRole: '',
        tools: [],
      },
      isAborted: false,
      messages: [
        {
          content: 'Hello',
          createdAt: Date.now(),
          id: '1',
          role: 'user',
          updatedAt: Date.now(),
        },
      ],
      metadata: {
        maxTokens: 4096,
        model: 'gpt-4',
      },
    };

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual(
      expect.objectContaining({
        content: 'You are in a test environment.',
        role: 'system',
      }),
    );
    expect(result.messages[1].role).toBe('user');
    expect(result.metadata.evalContextInjected).toBe(true);
  });

  it('should skip injection when enabled is false', async () => {
    const provider = new EvalContextSystemInjector({
      enabled: false,
      evalContext: { envPrompt: 'You are in a test environment.' },
    });

    const context = {
      initialState: {
        messages: [],
        model: 'gpt-4',
        provider: 'openai',
        systemRole: '',
        tools: [],
      },
      isAborted: false,
      messages: [
        {
          content: 'Hello',
          createdAt: Date.now(),
          id: '1',
          role: 'user',
          updatedAt: Date.now(),
        },
      ],
      metadata: {
        maxTokens: 4096,
        model: 'gpt-4',
      },
    };

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.metadata.evalContextInjected).toBeUndefined();
  });

  it('should skip injection when envPrompt is empty', async () => {
    const provider = new EvalContextSystemInjector({
      enabled: true,
      evalContext: { envPrompt: '' },
    });

    const context = {
      initialState: {
        messages: [],
        model: 'gpt-4',
        provider: 'openai',
        systemRole: '',
        tools: [],
      },
      isAborted: false,
      messages: [
        {
          content: 'Hello',
          createdAt: Date.now(),
          id: '1',
          role: 'user',
          updatedAt: Date.now(),
        },
      ],
      metadata: {
        maxTokens: 4096,
        model: 'gpt-4',
      },
    };

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.metadata.evalContextInjected).toBeUndefined();
  });

  it('should skip injection when evalContext is undefined', async () => {
    const provider = new EvalContextSystemInjector({ enabled: true });

    const context = {
      initialState: {
        messages: [],
        model: 'gpt-4',
        provider: 'openai',
        systemRole: '',
        tools: [],
      },
      isAborted: false,
      messages: [
        {
          content: 'Hello',
          createdAt: Date.now(),
          id: '1',
          role: 'user',
          updatedAt: Date.now(),
        },
      ],
      metadata: {
        maxTokens: 4096,
        model: 'gpt-4',
      },
    };

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.metadata.evalContextInjected).toBeUndefined();
  });

  it('should not modify original context', async () => {
    const provider = new EvalContextSystemInjector({
      enabled: true,
      evalContext: { envPrompt: 'Test env' },
    });

    const originalContent = 'Original system role';
    const context = {
      initialState: {
        messages: [],
        model: 'gpt-4',
        provider: 'openai',
        systemRole: '',
        tools: [],
      },
      isAborted: false,
      messages: [
        {
          content: originalContent,
          createdAt: Date.now(),
          id: 'system-1',
          role: 'system',
          updatedAt: Date.now(),
        },
      ],
      metadata: {
        maxTokens: 4096,
        model: 'gpt-4',
      },
    };

    await provider.process(context);

    expect(context.messages[0].content).toBe(originalContent);
    expect((context.metadata as any).evalContextInjected).toBeUndefined();
  });
});
