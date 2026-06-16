import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePageLockedBySelf } from './usePageLockedBySelf';

const mockPageState: {
  current: { documentId?: string; lockHolderId: string | null };
} = { current: { documentId: 'doc-1', lockHolderId: null } };

const mockUserState: { current: { id: string | undefined } } = {
  current: { id: 'user-me' },
};

const mockDocumentState: {
  current: { documents: Record<string, { saveBlockedByLock?: boolean }> };
} = { current: { documents: {} } };

vi.mock('./store', () => ({
  usePageEditorStore: (selector: any) => selector(mockPageState.current),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: any) => selector(mockUserState.current),
}));

vi.mock('@/store/user/slices/auth/selectors', () => ({
  userProfileSelectors: {
    userId: (s: any) => s.id,
  },
}));

vi.mock('@/store/document', () => ({
  useDocumentStore: (selector: any) => selector(mockDocumentState.current),
}));

vi.mock('@/store/document/slices/editor', () => ({
  editorSelectors: {
    saveBlockedByLock: (id: string) => (s: any) => Boolean(s.documents[id]?.saveBlockedByLock),
  },
}));

const isLockedByOtherMock = vi.fn(() => false);
vi.mock('./usePageLockedByOther', () => ({
  usePageLockedByOther: () => isLockedByOtherMock(),
}));

describe('usePageLockedBySelf', () => {
  beforeEach(() => {
    mockPageState.current = { documentId: 'doc-1', lockHolderId: null };
    mockUserState.current = { id: 'user-me' };
    mockDocumentState.current = { documents: {} };
    isLockedByOtherMock.mockReturnValue(false);
  });

  it('returns false when no one holds the lock', () => {
    const { result } = renderHook(() => usePageLockedBySelf());
    expect(result.current).toBe(false);
  });

  it('returns false when another user holds the lock', () => {
    mockPageState.current.lockHolderId = 'user-other';
    isLockedByOtherMock.mockReturnValue(true);
    const { result } = renderHook(() => usePageLockedBySelf());
    expect(result.current).toBe(false);
  });

  it('returns true when I hold the lock AND my save was just rejected', () => {
    mockPageState.current.lockHolderId = 'user-me';
    mockDocumentState.current.documents['doc-1'] = { saveBlockedByLock: true };
    const { result } = renderHook(() => usePageLockedBySelf());
    expect(result.current).toBe(true);
  });

  it('returns false when I hold the lock but nothing is blocking writes', () => {
    mockPageState.current.lockHolderId = 'user-me';
    const { result } = renderHook(() => usePageLockedBySelf());
    expect(result.current).toBe(false);
  });

  it('returns true when I hold the lock and the lock is reported as "by other" (future LOBE-10480 path)', () => {
    mockPageState.current.lockHolderId = 'user-me';
    isLockedByOtherMock.mockReturnValue(true);
    const { result } = renderHook(() => usePageLockedBySelf());
    expect(result.current).toBe(true);
  });

  it('returns false when the user is not authenticated yet', () => {
    mockPageState.current.lockHolderId = 'user-me';
    mockDocumentState.current.documents['doc-1'] = { saveBlockedByLock: true };
    mockUserState.current.id = undefined;
    const { result } = renderHook(() => usePageLockedBySelf());
    expect(result.current).toBe(false);
  });
});
