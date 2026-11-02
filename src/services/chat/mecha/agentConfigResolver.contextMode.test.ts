import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as agentStore from '@/store/agent';
import * as agentSelectors from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';

import { resolveAgentConfig } from './agentConfigResolver';

vi.hoisted(() => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
});

const mockChatConfig = { contextMode: 'default' as const, enableAgentMode: true };

describe('resolveAgentConfig context mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(agentStore, 'getAgentStoreState').mockReturnValue({} as any);
    vi.spyOn(agentSelectors.agentSelectors, 'getAgentConfigById').mockReturnValue(
      () =>
        ({
          model: 'gpt-4',
          plugins: [],
          systemRole: 'test',
        }) as any,
    );
    vi.spyOn(agentSelectors.agentSelectors, 'getAgentSlugById').mockReturnValue(() => undefined);
    vi.spyOn(agentSelectors.chatConfigByIdSelectors, 'getChatConfigById').mockReturnValue(
      () => mockChatConfig as any,
    );
    useUserStore.setState({ user: undefined, workspaceUserPreference: {} });
  });

  it('uses an ordinary member context mode for a public Workspace Agent', () => {
    vi.spyOn(agentSelectors.agentByIdSelectors, 'getAgentById').mockReturnValue(
      () => ({ userId: 'author-1', visibility: 'public', workspaceId: 'workspace-1' }) as any,
    );
    useUserStore.setState({
      user: { id: 'member-1' } as any,
      workspaceUserPreference: {
        agentContextModeOverrides: { 'test-agent': 'on-demand' },
        agentModeOverrides: { 'test-agent': true },
      },
    });

    const result = resolveAgentConfig({ agentId: 'test-agent' });

    expect(result.chatConfig).toMatchObject({
      contextMode: 'on-demand',
      enableAgentMode: true,
    });
  });

  it('ignores a member context mode for the Agent author', () => {
    vi.spyOn(agentSelectors.agentByIdSelectors, 'getAgentById').mockReturnValue(
      () => ({ userId: 'author-1', visibility: 'public', workspaceId: 'workspace-1' }) as any,
    );
    useUserStore.setState({
      user: { id: 'author-1' } as any,
      workspaceUserPreference: {
        agentContextModeOverrides: { 'test-agent': 'on-demand' },
      },
    });

    const result = resolveAgentConfig({ agentId: 'test-agent' });

    expect(result.chatConfig.contextMode).toBe('default');
  });
});
