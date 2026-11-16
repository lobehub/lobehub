import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initialState, useMcpAppStore } from '@/store/mcpApp/store';

import { useMcpAppPaneSource } from './useMcpAppPaneSource';

const mocks = vi.hoisted(() => ({ chat: { dbMessagesMap: {} as Record<string, any[]> } }));

vi.mock('@/features/MCPApp/useMcpAppIdentity', () => ({
  useMcpAppIdentity: () => ['Fixture App', 'fixture.png'],
}));
vi.mock('@/hooks/useToolResultPayload', () => ({ useToolResultPayload: () => ({}) }));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: typeof mocks.chat) => unknown) => selector(mocks.chat),
}));
vi.mock('@/store/chat/selectors', () => ({
  dbMessageSelectors: {
    getDbMessageById: (id: string) => (state: typeof mocks.chat) =>
      Object.values(state.dbMessagesMap)
        .flat()
        .find((message) => message.id === id),
  },
}));
vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/electron/selectors/gateway', () => ({
  electronGatewaySelectors: { gatewayStableDeviceId: () => null },
}));

const toolResult = {
  agentId: 'agent',
  content: 'opened',
  id: 'msg_tool',
  plugin: { apiName: 'open', arguments: '{}', identifier: 'fixture' },
  pluginState: { content: [], mcpApp: { resourceUri: 'ui://fixture/view' } },
  role: 'tool',
  tool_call_id: 'call_1',
};

beforeEach(() => {
  mocks.chat.dbMessagesMap = { 'topic-a': [toolResult] };
  useMcpAppStore.setState(initialState);
});

describe('useMcpAppPaneSource', () => {
  it('restores a tab reopened with its conversation from the tool call', () => {
    const { result } = renderHook(() => useMcpAppPaneSource('call_1', 'topic-a'));

    expect(result.current).toMatchObject({
      icon: 'fixture.png',
      mcpApp: { resourceUri: 'ui://fixture/view' },
      message: { id: 'msg_tool' },
      title: 'Fixture App',
    });
  });

  it('keeps a view with the conversation that produced it', () => {
    useMcpAppStore.setState({
      views: {
        call_1: {
          identifier: 'fixture',
          messageId: 'msg_tool',
          mode: 'fullscreen',
          placed: true,
          scope: 'topic-a',
          title: 'Fixture App',
        },
      },
    });

    // A thread opened in the same topic has its own conversation key
    const { result } = renderHook(() => useMcpAppPaneSource('call_1', 'topic-a:thread'));

    expect(result.current).toBeUndefined();
    expect(useMcpAppStore.getState().views.call_1.scope).toBe('topic-a');
  });

  it("does not take a result from another conversation's messages", () => {
    const { result } = renderHook(() => useMcpAppPaneSource('call_1', 'topic-b'));

    expect(result.current).toBeUndefined();
  });
});
