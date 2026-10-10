import type { DocumentItem } from '@lobechat/database/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentSourceType, type LobeDocument } from '@/types/document';

import { pageActions } from './action';
import { PAGE_LIST_KEY, TEMP_PAGE_ID_PREFIX } from './projection';
import { usePageStore } from './store';

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

vi.mock('@/services/document', () => ({
  documentService: {
    createDocument: vi.fn(),
    deleteDocument: vi.fn(),
    getDocumentById: vi.fn(),
    updateDocument: vi.fn(),
  },
}));

const { documentService } = await import('@/services/document');

/** A `documents` row as the server returns it. */
const row = (id: string, overrides: Partial<DocumentItem> = {}): DocumentItem =>
  ({
    content: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    editorData: null,
    fileType: 'custom/document',
    filename: `${id}.md`,
    id,
    metadata: {},
    parentId: null,
    source: 'document',
    sourceType: DocumentSourceType.API,
    title: id,
    totalCharCount: 0,
    totalLineCount: 0,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    userId: 'user-1',
    visibility: 'public',
    workspaceId: null,
    ...overrides,
  }) as unknown as DocumentItem;

const lobeDoc = (id: string, overrides: Partial<LobeDocument> = {}): LobeDocument => ({
  content: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  editorData: null,
  fileType: 'custom/document',
  filename: id,
  id,
  metadata: {},
  source: 'document',
  sourceType: DocumentSourceType.API,
  title: id,
  totalCharCount: 0,
  totalLineCount: 0,
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  visibility: 'public',
  workspaceId: null,
  ...overrides,
});

const items = () => usePageStore.getState().pageListMap[PAGE_LIST_KEY]?.items ?? [];

/** Seed a loaded list (no replica bookkeeping), as a fetched head page leaves it. */
const seedList = (docs: LobeDocument[]) => {
  usePageStore.setState({
    pageListMap: {
      [PAGE_LIST_KEY]: {
        currentPage: 0,
        hasMore: false,
        items: docs,
        pageSize: 20,
        total: docs.length,
      },
    },
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  pageActions.reset();
});

describe('pageActions — createNewPage', () => {
  it('shows an optimistic row, then swaps in the server row and navigates to it', async () => {
    const navigate = vi.fn();
    usePageStore.setState({ navigate });
    vi.mocked(documentService.createDocument).mockResolvedValue(
      row('docnew1', { title: 'My page', visibility: 'private' }),
    );

    const id = await pageActions.createNewPage('My page', 'private');

    expect(id).toBe('docnew1');
    // The optimistic row (client-minted id) is gone, the real row is in place.
    expect(items().map((doc) => doc.id)).toEqual(['docnew1']);
    expect(items()[0].visibility).toBe('private');
    expect(items()[0].title).toBe('My page');
    expect(usePageStore.getState().selectedPageId).toBe('docnew1');
    expect(usePageStore.getState().isCreatingNew).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/page/docnew1');
  });

  it('shows the optimistic row while the request is in flight', async () => {
    let resolve!: (value: DocumentItem) => void;
    vi.mocked(documentService.createDocument).mockReturnValue(
      new Promise<DocumentItem>((r) => {
        resolve = r;
      }),
    );

    const pending = pageActions.createNewPage('Pending page');
    // Yield so the optimistic dispatch has run.
    await Promise.resolve();

    expect(items()).toHaveLength(1);
    expect(items()[0].id.startsWith(TEMP_PAGE_ID_PREFIX)).toBe(true);
    expect(items()[0].title).toBe('Pending page');
    expect(usePageStore.getState().isCreatingNew).toBe(true);

    resolve(row('docreal1'));
    await pending;

    expect(items().map((doc) => doc.id)).toEqual(['docreal1']);
  });

  it('drops the optimistic row and rethrows when creation fails', async () => {
    const navigate = vi.fn();
    usePageStore.setState({ navigate });
    vi.mocked(documentService.createDocument).mockRejectedValue(new Error('boom'));

    await expect(pageActions.createNewPage('My page')).rejects.toThrow('boom');

    expect(items()).toEqual([]);
    expect(usePageStore.getState().selectedPageId).toBeNull();
    expect(usePageStore.getState().isCreatingNew).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/page');
  });
});

describe('pageActions — removePage', () => {
  it('drops the row optimistically and restores it when the delete fails', async () => {
    seedList([lobeDoc('docs_a'), lobeDoc('docs_b')]);
    vi.mocked(documentService.deleteDocument).mockRejectedValue(new Error('nope'));

    await expect(pageActions.removePage('docs_a')).rejects.toThrow('nope');

    expect(items().map((doc) => doc.id)).toEqual(['docs_a', 'docs_b']);
  });

  it('keeps the row removed once the server confirms the delete', async () => {
    seedList([lobeDoc('docs_a'), lobeDoc('docs_b')]);
    vi.mocked(documentService.deleteDocument).mockResolvedValue(undefined);

    await pageActions.removePage('docs_a');

    expect(documentService.deleteDocument).toHaveBeenCalledWith('docs_a');
    expect(items().map((doc) => doc.id)).toEqual(['docs_b']);
  });

  it('clears the selection and navigates away when the selected page is deleted', async () => {
    const navigate = vi.fn();
    seedList([lobeDoc('docs_a')]);
    usePageStore.setState({ navigate, selectedPageId: 'docs_a' });
    vi.mocked(documentService.deleteDocument).mockResolvedValue(undefined);

    await pageActions.removePage('docs_a');

    expect(usePageStore.getState().selectedPageId).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/page');
  });
});

describe('pageActions — updatePageOptimistically', () => {
  it('patches the title and emoji across the list and the by-id copy', async () => {
    seedList([lobeDoc('docs_a', { title: 'Old' })]);
    usePageStore.setState({ pageDetailMap: { docs_a: lobeDoc('docs_a', { title: 'Old' }) } });
    vi.mocked(documentService.updateDocument).mockResolvedValue({} as never);

    await pageActions.updatePageOptimistically('docs_a', {
      emoji: '🚀',
      title: 'Renamed',
    });

    expect(usePageStore.getState().pageListMap[PAGE_LIST_KEY]?.items[0].title).toBe('Renamed');
    expect(usePageStore.getState().pageListMap[PAGE_LIST_KEY]?.items[0].metadata.emoji).toBe('🚀');
    expect(usePageStore.getState().pageDetailMap['docs_a'].title).toBe('Renamed');
    expect(documentService.updateDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'docs_a', title: 'Renamed' }),
    );
  });

  it('warns and leaves the store untouched for a page that is not loaded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const before = usePageStore.getState().pageListMap;

    await pageActions.updatePageOptimistically('missing', { title: 'Renamed' });

    expect(documentService.updateDocument).not.toHaveBeenCalled();
    expect(usePageStore.getState().pageListMap).toBe(before);
    warn.mockRestore();
  });
});

describe('pageActions — duplicatePage', () => {
  it('inserts the copy at the head of the list', async () => {
    seedList([lobeDoc('docs_a')]);
    vi.mocked(documentService.getDocumentById).mockResolvedValue(row('docs_a'));
    vi.mocked(documentService.createDocument).mockResolvedValue(row('docs_copy'));

    const newPage = await pageActions.duplicatePage('docs_a');

    expect(newPage.id).toBe('docs_copy');
    expect(items().map((doc) => doc.id)).toEqual(['docs_copy', 'docs_a']);
  });
});

describe('pageActions — renamePage', () => {
  it('clears the in-place rename marker even when the title did not exist', async () => {
    usePageStore.setState({ renamingPageId: 'docs_a' });

    await pageActions.renamePage('docs_a', 'Renamed');

    expect(usePageStore.getState().renamingPageId).toBeNull();
  });
});
