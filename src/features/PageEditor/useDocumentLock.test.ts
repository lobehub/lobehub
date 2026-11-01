import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDocumentStore } from '@/store/document';

import { useDocumentLock } from './useDocumentLock';

const mockPageState: {
  current: Record<string, unknown>;
} = { current: {} };

vi.mock('./store', () => ({
  usePageEditorStore: (selector: any) => selector(mockPageState.current),
}));

vi.mock('./usePageLockedByOther', () => ({
  usePageLockedByOther: () => false,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: () => ({ canEditResource: true }),
}));

vi.mock('@/features/EditLock', () => ({
  useEditLock: () => ({
    expiresAt: null,
    health: 'healthy',
    holderId: null,
    lockedByOther: false,
    ownerId: undefined,
    pending: false,
  }),
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
}));

vi.mock('@/services/document', () => ({
  documentService: {
    acquireDocumentLock: vi.fn(),
    getDocumentLock: vi.fn().mockResolvedValue({ holderId: null }),
    releaseDocumentLock: vi.fn(),
  },
}));

const createMockEditor = () =>
  ({
    getDocument: vi.fn(() => null),
    setDocument: vi.fn(),
  }) as any;

describe('useDocumentLock — lockOwnerId publication into the document store', () => {
  beforeEach(() => {
    const state = useDocumentStore.getState();
    Object.keys(state.documents).forEach((id) => state.closeDocument(id));
    mockPageState.current = {
      documentId: 'doc-1',
      isWorkspacePage: true,
      lockExpiresAt: null,
      lockOwnerId: undefined,
      setLockHealth: vi.fn(),
      setLockOwnerId: vi.fn(),
      setLockPending: vi.fn(),
      setLockState: vi.fn(),
    };
  });

  it('publishes lockOwnerId after the document loads into the store post-mount', () => {
    // On first mount the SWR fetch has not landed yet, so the store has no
    // document row and the initial `updateDocument` dispatch is dropped by the
    // reducer. The hook must re-publish once the document exists — otherwise
    // every save goes out with `lockOwnerId: undefined` and the server rejects
    // it as a CONFLICT against the user's own lease.
    renderHook(() => useDocumentLock());

    expect(useDocumentStore.getState().documents['doc-1']).toBeUndefined();

    act(() => {
      useDocumentStore.getState().initDocumentWithEditor({
        content: '# Test',
        documentId: 'doc-1',
        editor: createMockEditor(),
        sourceType: 'page',
      });
    });

    const doc = useDocumentStore.getState().documents['doc-1'];
    expect(doc).toBeDefined();
    expect(doc.lockOwnerId).toMatch(/^page:doc-1:/);
  });

  it('publishes lockOwnerId immediately when the document is already in the store', () => {
    act(() => {
      useDocumentStore.getState().initDocumentWithEditor({
        content: '# Test',
        documentId: 'doc-1',
        editor: createMockEditor(),
        sourceType: 'page',
      });
    });

    renderHook(() => useDocumentLock());

    expect(useDocumentStore.getState().documents['doc-1'].lockOwnerId).toMatch(/^page:doc-1:/);
  });

  it('clears lockOwnerId from the document store on unmount', () => {
    act(() => {
      useDocumentStore.getState().initDocumentWithEditor({
        content: '# Test',
        documentId: 'doc-1',
        editor: createMockEditor(),
        sourceType: 'page',
      });
    });

    const { unmount } = renderHook(() => useDocumentLock());
    expect(useDocumentStore.getState().documents['doc-1'].lockOwnerId).toBeDefined();

    unmount();
    expect(useDocumentStore.getState().documents['doc-1'].lockOwnerId).toBeUndefined();
  });
});
