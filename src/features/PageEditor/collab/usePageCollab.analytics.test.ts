import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    destroy = vi.fn();
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

const roomJoinedCalls = () =>
  mocks.track.mock.calls.filter(([event]) => event.name === 'page_collab_room_joined');

describe('usePageCollab analytics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T00:00:00Z'));
    mocks.events = undefined;
    mocks.track.mockReset();
    useDocumentStore.setState({
      documentDetailMap: {
        [DOC_ID]: { document: { id: DOC_ID, workspaceId: 'ws_1' } as any } as any,
      },
      documents: { [DOC_ID]: { content: '', editorData: null, isDirty: false } as any },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports page_collab_room_joined once, on the first sync, with only elapsed_ms', () => {
    renderCollab();
    vi.advanceTimersByTime(1200);

    act(() => events().onStatus?.('synced'));

    expect(roomJoinedCalls()).toEqual([
      [{ name: 'page_collab_room_joined', properties: { elapsed_ms: 1200 } }],
    ]);
  });

  it('does not report the join again when the same session reconnects', () => {
    renderCollab();

    act(() => {
      events().onStatus?.('synced');
      events().onStatus?.('offline');
      events().onStatus?.('connecting');
      events().onStatus?.('synced');
      events().onStatus?.('synced');
    });

    expect(roomJoinedCalls()).toHaveLength(1);
  });

  it('reports no join when the room fails, and keeps the failure event unchanged', () => {
    renderCollab();

    act(() => {
      events().onStatus?.('error');
      events().onFailure?.({ code: 'sync_timeout', elapsedMs: 10_000 });
    });

    expect(roomJoinedCalls()).toHaveLength(0);
    expect(mocks.track.mock.calls).toEqual([
      [
        {
          name: 'page_collab_sync_failed',
          properties: { code: 'sync_timeout', elapsed_ms: 10_000 },
        },
      ],
    ]);
  });

  it('counts a failure and a later successful retry as one event each', () => {
    renderCollab();
    vi.advanceTimersByTime(500);

    act(() => {
      events().onStatus?.('error');
      events().onFailure?.({ code: 'sync_timeout', elapsedMs: 500 });
    });
    vi.advanceTimersByTime(300);
    act(() => {
      events().onStatus?.('connecting');
      events().onStatus?.('synced');
    });

    expect(mocks.track.mock.calls.map(([event]) => event.name)).toEqual([
      'page_collab_sync_failed',
      'page_collab_room_joined',
    ]);
    expect(roomJoinedCalls()[0][0].properties).toEqual({ elapsed_ms: 800 });
  });
});
