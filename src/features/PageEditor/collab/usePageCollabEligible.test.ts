import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDocumentStore } from '@/store/document';

import { usePageCollabEligible } from './usePageCollab';

vi.mock('@/store/serverConfig', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getServerConfigStoreState: () => ({
    serverConfig: { agentGatewayUrl: 'wss://gateway.example.com', enablePageCollab: true },
  }),
}));

const loadDocument = (workspaceId: string | null) =>
  useDocumentStore.setState({
    documentDetailMap: { doc_1: { document: { id: 'doc_1', workspaceId } as any } as any },
    documents: { doc_1: { content: '', editorData: null, isDirty: false } as any },
  });

describe('usePageCollabEligible', () => {
  beforeEach(() => {
    useDocumentStore.setState({ documentDetailMap: {}, documents: {} });
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
});
