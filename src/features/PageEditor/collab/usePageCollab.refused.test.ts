import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDocumentStore } from '@/store/document';
import {
  initServerConfigStore,
  Provider as ServerConfigProvider,
} from '@/store/serverConfig/store';

import { createStore, Provider as PageEditorProvider } from '../store';
import type { PageCollabProviderEvents } from './provider';
import { usePageCollab } from './usePageCollab';

const mocks = vi.hoisted(() => ({
  events: undefined as PageCollabProviderEvents | undefined,
  destroy: vi.fn(),
  track: vi.fn(),
}));

vi.mock('@/libs/analytics/client', () => ({
  analyticsClient: { track: mocks.track },
}));

vi.mock('@/store/serverConfig', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getServerConfigStoreState: () => ({
    serverConfig: {
      agentGatewayUrl: 'wss://gateway.example.com',
      enableWorkspacePageCollab: true,
    },
  }),
}));

vi.mock('@/store/chat/slices/agentRun/actions/transports/gateway/muxRegistry', () => ({
  getGatewayMux: () => ({}),
}));

vi.mock('./usePresenceColor', () => ({ usePresenceColor: () => {} }));

vi.mock('./provider', () => ({
  PageCollabProvider: class {
    awareness = { getLocalState: () => null, setLocalState: vi.fn() };
    pendingCount = 0;
    constructor(_id: string, _doc: unknown, _mux: unknown, events: PageCollabProviderEvents) {
      mocks.events = events;
    }
    connect = vi.fn();
    destroy = mocks.destroy;
    retry = vi.fn();
  },
}));

const DOC_ID = 'doc_1';

const renderCollab = () => {
  const serverConfigStore = initServerConfigStore({});
  serverConfigStore.setState((s) => ({
    featureFlags: { ...s.featureFlags, enablePageCollab: true },
  }));
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      ServerConfigProvider,
      { createStore: () => serverConfigStore },
      createElement(PageEditorProvider, { createStore: () => createStore() }, children),
    );
  return renderHook(() => usePageCollab(DOC_ID), { wrapper });
};

const events = () => {
  if (!mocks.events) throw new Error('the room provider was not created');
  return mocks.events;
};

describe('usePageCollab when the room turns the member away', () => {
  beforeEach(() => {
    mocks.events = undefined;
    mocks.destroy.mockReset();
    useDocumentStore.setState({
      documentDetailMap: {
        [DOC_ID]: { document: { id: DOC_ID, workspaceId: 'ws_1' } as any } as any,
      },
      documents: { [DOC_ID]: { content: '', editorData: null, isDirty: false } as any },
    });
  });

  it('leaves the room and edits the stored page instead', () => {
    const { result } = renderCollab();
    expect(result.current).toBeDefined();

    act(() => events().onRefused?.());

    expect(result.current).toBeUndefined();
    expect(mocks.destroy).toHaveBeenCalled();
    expect(useDocumentStore.getState().documents[DOC_ID].collab).toBe(false);
  });
});
