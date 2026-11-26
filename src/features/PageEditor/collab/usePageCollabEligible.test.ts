import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDocumentStore } from '@/store/document';
import { useUserStore } from '@/store/user';

import { usePageCollabEligible } from './usePageCollab';

const serverConfig = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));

vi.mock('@/store/serverConfig', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getServerConfigStoreState: () => ({ serverConfig: serverConfig.value }),
}));

const setPageCollabLab = (enablePageCollab: boolean) =>
  useUserStore.setState((s) => ({
    preference: { ...s.preference, lab: { ...s.preference.lab, enablePageCollab } },
  }));

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
    setPageCollabLab(true);
  });

  it('keeps a workspace page out of rooms until the user turns on the lab', () => {
    setPageCollabLab(false);
    loadDocument('ws_1');

    expect(renderHook(() => usePageCollabEligible('doc_1')).result.current).toBe(false);
  });

  it('puts a workspace page in a room', () => {
    loadDocument('ws_1');

    expect(renderHook(() => usePageCollabEligible('doc_1')).result.current).toBe(true);
  });

  it('keeps a personal page out of rooms', () => {
    loadDocument(null);

    expect(renderHook(() => usePageCollabEligible('doc_1')).result.current).toBe(false);
  });

  it('leaves the room path only once the page is known to be personal', () => {
    expect(renderHook(() => usePageCollabEligible('doc_1')).result.current).toBe(true);
  });

  it('stays out of rooms when only the flag for older clients is on', () => {
    serverConfig.value = { agentGatewayUrl: 'wss://gateway.example.com', enablePageCollab: true };
    loadDocument('ws_1');

    expect(renderHook(() => usePageCollabEligible('doc_1')).result.current).toBe(false);
  });
});
