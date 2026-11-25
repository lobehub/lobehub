import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import * as agentStore from '@/store/agent';
import {
  agentByIdSelectors,
  agentSelectors,
  chatConfigByIdSelectors,
} from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';

import { resolveAgentConfig } from './agentConfigResolver';

beforeEach(() => {
  vi.spyOn(agentStore, 'getAgentStoreState').mockReturnValue({} as never);
  vi.spyOn(agentByIdSelectors, 'getAgentById').mockReturnValue(() => undefined);
  vi.spyOn(agentSelectors, 'getAgentSlugById').mockReturnValue(() => undefined);
  vi.spyOn(agentSelectors, 'getAgentConfigById').mockReturnValue(
    () => ({ model: 'gpt-4', plugins: [], systemRole: '' }) as never,
  );
  vi.spyOn(chatConfigByIdSelectors, 'getChatConfigById').mockReturnValue(
    () => ({ enableAgentMode: true }) as never,
  );
  useUserStore.setState({ user: undefined, workspaceUserPreference: {} });
});

afterEach(() => vi.restoreAllMocks());

it('uses the server-confirmed conversation mode over local preferences', () => {
  const result = resolveAgentConfig({ agentId: 'test-agent' }, 'chat');
  expect(result.chatConfig.enableAgentMode).toBe(false);
  expect(result.chatConfig.toolMode).toBe('chat');
});
