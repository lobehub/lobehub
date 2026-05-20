import { describe, expect, it } from 'vitest';

import { SystemRoleInjector } from '../SystemRoleInjector';

describe('SystemRoleInjector', () => {
  it('should inject system role at the beginning of messages', async () => {
    const provider = new SystemRoleInjector({
      systemRole: 'You are a helpful assistant.',
    });

    const context = {
      initialState: {
        messages: [],
        model: 'gpt-4',
        provider: 'openai',
        systemRole: '',
        tools: [],
      },
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'Hello',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      metadata: {
        model: 'gpt-4',
        maxTokens: 4096,
      },
      isAborted: false,
    };

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual(
      expect.objectContaining({
        content: 'You are a helpful assistant.',
        role: 'system',
      }),
    );
    expect(result.messages[1]).toEqual(
      expect.objectContaining({
        content: 'Hello',
        role: 'user',
      }),
    );
    expect(result.metadata.systemRoleInjected).toBe(true);
  });

  it('should skip injection when no system role is configured', async () => {
    const provider = new SystemRoleInjector({
      systemRole: '',
    });

    const context = {
      initialState: {
        messages: [],
        model: 'gpt-4',
        provider: 'openai',
        systemRole: '',
        tools: [],
      },
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'Hello',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      metadata: {
        model: 'gpt-4',
        maxTokens: 4096,
      },
      isAborted: false,
    };

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.metadata.systemRoleInjected).toBeUndefined();
  });

  it('should append system role to existing system message', async () => {
    const provider = new SystemRoleInjector({
      systemRole: 'You are a helpful assistant.',
    });

    const context = {
      initialState: {
        messages: [],
        model: 'gpt-4',
        provider: 'openai',
        systemRole: '',
        tools: [],
      },
      messages: [
        {
          id: 'system-1',
          role: 'system',
          content: 'Existing system role',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: '1',
          role: 'user',
          content: 'Hello',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      metadata: {
        model: 'gpt-4',
        maxTokens: 4096,
      },
      isAborted: false,
    };

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toBe('Existing system role\n\nYou are a helpful assistant.');
    expect(result.messages[1].role).toBe('user');
    expect(result.metadata.systemRoleInjected).toBe(true);
  });

  it('should append systemRole after AgentDocumentBeforeSystemInjector output (regression for LOBE-6892)', async () => {
    const provider = new SystemRoleInjector({
      systemRole: '你是一个思维活跃的工程师，擅长 Python、JavaScript、Docker、SQL。',
    });

    const beforeSystemDocContent =
      '<agent_documents>\n<document title="rules">always reply in Chinese</document>\n</agent_documents>';

    const context = {
      initialState: {
        messages: [],
        model: 'gpt-4',
        provider: 'openai',
        systemRole: '',
        tools: [],
      },
      messages: [
        // Simulates the message that AgentDocumentBeforeSystemInjector unshifts
        {
          id: 'agent-doc-before-system-1700000000000',
          role: 'system',
          content: beforeSystemDocContent,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: '1',
          role: 'user',
          content: 'Hello',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      metadata: {
        model: 'gpt-4',
        maxTokens: 4096,
      },
      isAborted: false,
    };

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('system');
    // doc content stays in front, systemRole appended after with \n\n separator
    expect(result.messages[0].content).toBe(
      `${beforeSystemDocContent}\n\n你是一个思维活跃的工程师，擅长 Python、JavaScript、Docker、SQL。`,
    );
    expect(result.messages[1].role).toBe('user');
    expect(result.metadata.systemRoleInjected).toBe(true);
  });

  it('should handle whitespace-only system role', async () => {
    const provider = new SystemRoleInjector({
      systemRole: '   \n  \t  ',
    });

    const context = {
      initialState: {
        messages: [],
        model: 'gpt-4',
        provider: 'openai',
        systemRole: '',
        tools: [],
      },
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'Hello',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      metadata: {
        model: 'gpt-4',
        maxTokens: 4096,
      },
      isAborted: false,
    };

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.metadata.systemRoleInjected).toBeUndefined();
  });

  it('should skip injection when systemRole is a non-string truthy value (object)', async () => {
    const provider = new SystemRoleInjector({
      systemRole: { nested: 'object' } as any,
    });

    const context = {
      initialState: { messages: [], model: 'gpt-4', provider: 'openai', systemRole: '', tools: [] },
      messages: [
        { id: '1', role: 'user', content: 'Hello', createdAt: Date.now(), updatedAt: Date.now() },
      ],
      metadata: { model: 'gpt-4', maxTokens: 4096 },
      isAborted: false,
    };

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.metadata.systemRoleInjected).toBeUndefined();
  });

  it('should skip injection when systemRole is an array', async () => {
    const provider = new SystemRoleInjector({
      systemRole: ['system', 'role'] as any,
    });

    const context = {
      initialState: { messages: [], model: 'gpt-4', provider: 'openai', systemRole: '', tools: [] },
      messages: [
        { id: '1', role: 'user', content: 'Hello', createdAt: Date.now(), updatedAt: Date.now() },
      ],
      metadata: { model: 'gpt-4', maxTokens: 4096 },
      isAborted: false,
    };

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
  });

  it('should skip injection when systemRole is a number', async () => {
    const provider = new SystemRoleInjector({
      systemRole: 42 as any,
    });

    const context = {
      initialState: { messages: [], model: 'gpt-4', provider: 'openai', systemRole: '', tools: [] },
      messages: [
        { id: '1', role: 'user', content: 'Hello', createdAt: Date.now(), updatedAt: Date.now() },
      ],
      metadata: { model: 'gpt-4', maxTokens: 4096 },
      isAborted: false,
    };

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
  });

  it('should handle empty message array', async () => {
    const provider = new SystemRoleInjector({
      systemRole: 'You are a helpful assistant.',
    });

    const context = {
      initialState: {
        messages: [],
        model: 'gpt-4',
        provider: 'openai',
        systemRole: '',
        tools: [],
      },
      messages: [],
      metadata: {
        model: 'gpt-4',
        maxTokens: 4096,
      },
      isAborted: false,
    };

    const result = await provider.process(context);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual(
      expect.objectContaining({
        content: 'You are a helpful assistant.',
        role: 'system',
      }),
    );
    expect(result.metadata.systemRoleInjected).toBe(true);
  });
});
