import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

interface SendToMessengerParams {
  enabled: boolean;
  file: { fileType?: string; id: string; name?: string; size?: number };
}

const mocks = vi.hoisted(() => ({
  useSendToMessengerMenuItem: vi.fn((_params: SendToMessengerParams) => undefined),
}));

vi.mock('@/features/Messenger/PushResourceModal/useSendToMessengerMenuItem', () => ({
  useSendToMessengerMenuItem: mocks.useSendToMessengerMenuItem,
}));
vi.mock('@/hooks/useAppOrigin', () => ({ useAppOrigin: () => 'https://app.example.com' }));
vi.mock('@/hooks/useResourceManageable', () => ({ useResourceManageable: () => true }));
vi.mock('@/features/ResourceManager/components/KnowledgeBaseListProvider', () => ({
  useKnowledgeBaseListContext: () => [],
}));
vi.mock('@/store/user', () => ({ useUserStore: () => 'user-1' }));
vi.mock('@/store/user/selectors', () => ({ userProfileSelectors: { userId: vi.fn() } }));
vi.mock('@/store/file', () => ({
  useFileStore: () => ({
    deleteResource: vi.fn(),
    moveResource: vi.fn(),
    publishFileToWorkspace: vi.fn(),
    refreshFileList: vi.fn(),
    setFileVisibility: vi.fn(),
  }),
}));
vi.mock('@/store/library', () => ({ useKnowledgeBaseStore: () => [vi.fn(), vi.fn()] }));
vi.mock('@/store/tree', () => ({ useTreeStore: () => vi.fn() }));

const { useFileItemDropdown } = await import('./useFileItemDropdown');

const baseParams = {
  fileType: 'markdown',
  filename: 'notes.md',
  id: 'resource-id',
  size: 10,
  url: 'https://storage.example.com/notes.md',
};

const pushedFile = () => mocks.useSendToMessengerMenuItem.mock.calls.at(-1)![0].file;

describe('useFileItemDropdown — messenger push id', () => {
  it('sends the underlying fileId, not the list id, for a file behind a derived page', () => {
    // Regression: the unified resource list keys such a row by the PAGE id, but
    // the server resolves the attachment by `files.id` — pushing sent an id the
    // file table has never seen and the call failed with NOT_FOUND.
    renderHook(() => useFileItemDropdown({ ...baseParams, fileId: 'file-id' } as any));

    expect(pushedFile().id).toBe('file-id');
  });

  it('falls back to the row id when there is no separate fileId', () => {
    renderHook(() => useFileItemDropdown({ ...baseParams, fileId: undefined } as any));

    expect(pushedFile().id).toBe('resource-id');
  });

  it('falls back to the row id when fileId is null', () => {
    // `toTreeItem` carries `fileId` straight from the API, which yields null
    // (not undefined) for rows with no backing file.
    renderHook(() => useFileItemDropdown({ ...baseParams, fileId: null } as any));

    expect(pushedFile().id).toBe('resource-id');
  });
});
