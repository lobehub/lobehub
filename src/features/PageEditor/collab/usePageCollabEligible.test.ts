import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDocumentStore } from '@/store/document';
import { initServerConfigStore, Provider } from '@/store/serverConfig/store';

import { usePageCollabEligible } from './usePageCollab';

const serverConfig = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));

vi.mock('@/store/serverConfig', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getServerConfigStoreState: () => ({ serverConfig: serverConfig.value }),
}));

let serverConfigStore: ReturnType<typeof initServerConfigStore>;

const setPageCollabFlag = (enablePageCollab: boolean | undefined) =>
  serverConfigStore.setState((s) => ({
    featureFlags: { ...s.featureFlags, enablePageCollab },
  }));

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(Provider, { createStore: () => serverConfigStore }, children);

const renderEligible = () => renderHook(() => usePageCollabEligible('doc_1'), { wrapper });

const loadDocument = (workspaceId: string | null) =>
  useDocumentStore.setState({
    documentDetailMap: { doc_1: { document: { id: 'doc_1', workspaceId } as any } as any },
    documents: { doc_1: { content: '', editorData: null, isDirty: false } as any },
  });

describe('usePageCollabEligible', () => {
  beforeEach(() => {
    serverConfig.value = {
      agentGatewayUrl: 'wss://gateway.example.com',
      enableWorkspacePageCollab: true,
    };
    useDocumentStore.setState({ documentDetailMap: {}, documents: {} });
    serverConfigStore = initServerConfigStore({});
    setPageCollabFlag(true);
  });

  it('keeps a workspace page out of rooms while the page_collab flag is off', () => {
    setPageCollabFlag(false);
    loadDocument('ws_1');

    expect(renderEligible().result.current).toBe(false);
  });

  it('keeps a workspace page out of rooms when only the deployment runs rooms', () => {
    // The deployment field alone (no runtime flag evaluated for the user) is not enough.
    setPageCollabFlag(undefined);
    loadDocument('ws_1');

    expect(renderEligible().result.current).toBe(false);
  });

  it('puts a workspace page in a room when the flag is on and the deployment runs rooms', () => {
    loadDocument('ws_1');

    expect(renderEligible().result.current).toBe(true);
  });

  it('follows the flag when it changes after mount', () => {
    setPageCollabFlag(false);
    loadDocument('ws_1');
    const { result, rerender } = renderEligible();
    expect(result.current).toBe(false);

    act(() => {
      setPageCollabFlag(true);
    });
    rerender();

    expect(result.current).toBe(true);
  });

  it('keeps a page the room turned away on stored editing', () => {
    loadDocument('ws_1');
    const { result, rerender } = renderEligible();
    expect(result.current).toBe(true);

    act(() => {
      useDocumentStore.getState().refuseDocumentCollab('doc_1');
    });
    rerender();

    expect(result.current).toBe(false);
  });

  it('keeps a personal page out of rooms', () => {
    loadDocument(null);

    expect(renderEligible().result.current).toBe(false);
  });

  it('leaves the room path only once the page is known to be personal', () => {
    expect(renderEligible().result.current).toBe(true);
  });

  it('stays out of rooms when the deployment does not run workspace rooms', () => {
    serverConfig.value = { agentGatewayUrl: 'wss://gateway.example.com', enablePageCollab: true };
    loadDocument('ws_1');

    expect(renderEligible().result.current).toBe(false);
  });
});
