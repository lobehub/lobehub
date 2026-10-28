import { expect, it, vi } from 'vitest';

import type { ChatStore } from '@/store/chat/store';

import { PluginTypesActionImpl } from './pluginTypes';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/store/chat/store', () => ({
  useChatStore: Object.assign(vi.fn(), { getState: () => ({}), setState: vi.fn() }),
}));
vi.mock('@/store/chat/slices/operation', () => ({ operationSelectors: {} }));
vi.mock('@/store/tool', () => ({ useToolStore: { getState: () => ({}) } }));
vi.mock('./exector', () => ({ composioExecutor: {}, lobehubSkillExecutor: {} }));
vi.mock('@/services/mcp', () => ({ mcpService: { invokeMcpToolCall: mocks.invoke } }));
vi.mock('@/services/toolResultArchive', () => ({
  archiveToolResultViaServer: async ({ content }: { content: string }) => content,
}));
vi.mock('../../message/selectors', () => ({
  dbMessageSelectors: { getDbMessageById: () => () => undefined },
}));
it('passes the actual MCP failure flag to the client runtime instead of turning an error string into success', async () => {
  mocks.invoke.mockResolvedValue({
    content: 'external failure',
    success: false,
    error: { message: 'external failure' },
  });
  const store = {
    operations: {},
    messageOperationMap: {},
    optimisticUpdateToolMessage: vi.fn(),
  } as unknown as ChatStore;
  const actions = new PluginTypesActionImpl(vi.fn(), () => store);
  const result = await actions.invokeMCPTypePlugin('tool-row', {
    id: 'call_1',
    identifier: 'fixture',
    apiName: 'form',
    arguments: '{}',
    type: 'mcp',
  });
  expect(result).toMatchObject({
    content: 'external failure',
    success: false,
    error: { message: 'external failure' },
  });
});
