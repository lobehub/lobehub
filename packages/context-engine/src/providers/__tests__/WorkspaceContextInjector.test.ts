import { describe, expect, it } from 'vitest';

import { WorkspaceContextInjector } from '../WorkspaceContextInjector';

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
  content: '把周报链接发我',
  createdAt: Date.now(),
  id: '1',
  role: 'user',
  updatedAt: Date.now(),
};

describe('WorkspaceContextInjector', () => {
  it('appends the workspace scope and slug-prefixed link rule to the system message', async () => {
    const provider = new WorkspaceContextInjector({
      context: {
        appUrl: 'https://app.lobehub.com',
        workspace: { slug: 'lobehub' },
      },
    });

    const result = await provider.process(createContext([systemMessage, userMessage]) as any);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toContain('You are a helpful assistant.');
    expect(result.messages[0].content).toContain('<workspace_context>');
    expect(result.messages[0].content).toContain('<workspace_slug>lobehub</workspace_slug>');
    expect(result.messages[0].content).toContain(
      '<link_base>https://app.lobehub.com/lobehub</link_base>',
    );
    expect(result.metadata.workspaceContextInjected).toBe(true);
  });

  it('creates a system message when none exists', async () => {
    const provider = new WorkspaceContextInjector({
      context: { appUrl: 'https://app.lobehub.com' },
    });

    const result = await provider.process(createContext([userMessage]) as any);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toContain('<scope>personal</scope>');
  });

  it('skips injection when disabled', async () => {
    const provider = new WorkspaceContextInjector({
      context: { appUrl: 'https://app.lobehub.com', workspace: { slug: 'lobehub' } },
      enabled: false,
    });

    const result = await provider.process(createContext([systemMessage, userMessage]) as any);

    expect(result.messages[0].content).toBe('You are a helpful assistant.');
    expect(result.metadata.workspaceContextInjected).toBeUndefined();
  });

  it('skips injection when there is no context or nothing to anchor on', async () => {
    const noContext = new WorkspaceContextInjector({});
    const emptyContext = new WorkspaceContextInjector({ context: {} });

    const a = await noContext.process(createContext([systemMessage, userMessage]) as any);
    const b = await emptyContext.process(createContext([systemMessage, userMessage]) as any);

    expect(a.messages[0].content).toBe('You are a helpful assistant.');
    expect(b.messages[0].content).toBe('You are a helpful assistant.');
  });
});
