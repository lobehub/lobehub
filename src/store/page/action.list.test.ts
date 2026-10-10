import { PAGE_DOCUMENT_FILE_TYPES, PAGE_DOCUMENT_SOURCE_TYPES } from '@lobechat/const';
import type { DocumentItem } from '@lobechat/database/schemas';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentSourceType, type LobeDocument } from '@/types/document';

import { pageActions } from './action';
import { PAGE_LIST_KEY } from './projection';
import { usePageStore } from './store';

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

vi.mock('@/services/document', () => ({
  documentService: {
    getDocumentById: vi.fn(),
    publishDocumentToWorkspace: vi.fn(),
    queryDocuments: vi.fn(),
    setDocumentVisibility: vi.fn(),
  },
}));

const { documentService } = await import('@/services/document');

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

/** The replica sync queries the slice registered with the SWR driver. */
const syncCalls = async (name: 'pageDetail' | 'pageList') => {
  const { useClientDataSWR } = await import('@/libs/swr');
  return vi
    .mocked(useClientDataSWR)
    .mock.calls.filter(
      ([key]) => Array.isArray(key) && key[0] === 'replica:sync' && key[1] === name,
    )
    .map(([key, fetcher]) => ({
      fetcher: fetcher as () => Promise<unknown>,
      key: key as unknown[],
    }));
};

const list = () => usePageStore.getState().pageListMap[PAGE_LIST_KEY];

beforeEach(() => {
  vi.clearAllMocks();
  pageActions.reset();
});

describe('pageActions — useFetchDocuments', () => {
  it('registers the one list entry and fetches the head page with the page filters', async () => {
    renderHook(() => pageActions.useFetchDocuments());

    const [call] = await syncCalls('pageList');
    expect(call.key[0]).toBe('replica:sync');
    expect(call.key[1]).toBe('pageList');
    expect(call.key[2]).toBe(1);
    // The whole Pages list is one entry.
    expect(call.key[4]).toBe(PAGE_LIST_KEY);
    expect(call.key[5]).toEqual({ pageSize: 20 });

    vi.mocked(documentService.queryDocuments).mockResolvedValue({
      items: [row('docs_a'), row('docs_b')],
      total: 2,
    });

    const page = (await call.fetcher()) as { items: LobeDocument[]; total: number };

    expect(documentService.queryDocuments).toHaveBeenCalledWith({
      current: 0,
      fileTypes: PAGE_DOCUMENT_FILE_TYPES,
      pageSize: 20,
      sourceTypes: PAGE_DOCUMENT_SOURCE_TYPES,
    });
    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.id)).toEqual(['docs_a', 'docs_b']);
    // Rows are converted at the boundary, so the whole store speaks LobeDocument.
    expect(page.items[0].createdAt).toBeInstanceOf(Date);
    // `filename` follows the display title, mirroring the old row converter.
    expect(page.items[0].filename).toBe('docs_a');
  });

  it('drops rows whose file type is not part of the pages list', async () => {
    renderHook(() => pageActions.useFetchDocuments());
    const [call] = await syncCalls('pageList');

    vi.mocked(documentService.queryDocuments).mockResolvedValue({
      items: [row('docs_page'), row('upload_1', { fileType: 'text/plain' })],
      total: 2,
    });

    const page = (await call.fetcher()) as { items: LobeDocument[] };

    expect(page.items.map((item) => item.id)).toEqual(['docs_page']);
  });
});

describe('pageActions — preHydrate', () => {
  it('seeds the list from the persisted row before anything mounts', async () => {
    const { pageListResource } = await import('./projection');
    const get = vi.spyOn(pageListResource.storage!, 'get').mockResolvedValue({
      data: {
        currentPage: 0,
        hasMore: true,
        items: [lobeDoc('docs_a'), lobeDoc('docs_b')],
        pageSize: 20,
        total: 51,
      },
      updatedAt: 1,
    });

    await expect(pageActions.preHydrate()).resolves.toBe(true);

    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: `${PAGE_LIST_KEY}?{"pageSize":20}` }),
    );
    expect(list()?.items.map((doc) => doc.id)).toEqual(['docs_a', 'docs_b']);
    expect(usePageStore.getState().pageListReplica.entries[PAGE_LIST_KEY]?.source).toBe('storage');
    get.mockRestore();
  });

  it('leaves the list empty when nothing is persisted', async () => {
    const { pageListResource } = await import('./projection');
    const get = vi.spyOn(pageListResource.storage!, 'get').mockResolvedValue(undefined);

    await expect(pageActions.preHydrate()).resolves.toBe(false);

    expect(list()).toBeUndefined();
    get.mockRestore();
  });
});

describe('pageActions — useFetchPageDetail', () => {
  it('registers a by-id sync keyed by the page id', async () => {
    renderHook(() => pageActions.useFetchPageDetail('docs_a'));

    const [call] = await syncCalls('pageDetail');
    expect(call.key[1]).toBe('pageDetail');
    expect(call.key[4]).toBe('docs_a');
  });

  it('does not register anything without a page id', async () => {
    renderHook(() => pageActions.useFetchPageDetail(undefined));

    expect(await syncCalls('pageDetail')).toHaveLength(0);
  });
});

describe('pageActions — loadMoreDocuments', () => {
  it('pages forward with the next offset and appends the rows', async () => {
    usePageStore.setState({
      pageListMap: {
        [PAGE_LIST_KEY]: {
          currentPage: 0,
          hasMore: true,
          items: [lobeDoc('docs_a')],
          pageSize: 20,
          total: 2,
        },
      },
    });
    vi.mocked(documentService.queryDocuments).mockResolvedValue({
      items: [row('docs_b')],
      total: 2,
    });

    await pageActions.loadMoreDocuments();

    expect(documentService.queryDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ current: 1, pageSize: 20 }),
    );
    expect(list()?.items.map((doc) => doc.id)).toEqual(['docs_a', 'docs_b']);
    expect(list()?.currentPage).toBe(1);
    expect(list()?.hasMore).toBe(false);
  });

  it('de-duplicates a row the server repeats across pages', async () => {
    usePageStore.setState({
      pageListMap: {
        [PAGE_LIST_KEY]: {
          currentPage: 0,
          hasMore: true,
          items: [lobeDoc('docs_a')],
          pageSize: 20,
          total: 3,
        },
      },
    });
    vi.mocked(documentService.queryDocuments).mockResolvedValue({
      items: [row('docs_a'), row('docs_b')],
      total: 3,
    });

    await pageActions.loadMoreDocuments();

    expect(list()?.items.map((doc) => doc.id)).toEqual(['docs_a', 'docs_b']);
  });

  it('does not page when the head page is all there is', async () => {
    usePageStore.setState({
      pageListMap: {
        [PAGE_LIST_KEY]: {
          currentPage: 0,
          hasMore: false,
          items: [lobeDoc('docs_a')],
          pageSize: 20,
          total: 1,
        },
      },
    });

    await pageActions.loadMoreDocuments();

    expect(documentService.queryDocuments).not.toHaveBeenCalled();
  });
});

describe('pageActions — upsertDocument', () => {
  it('mirrors a page document into the by-id projection and the loaded row', () => {
    usePageStore.setState({
      pageListMap: {
        [PAGE_LIST_KEY]: {
          currentPage: 0,
          hasMore: false,
          items: [lobeDoc('docs_a', { title: 'Old title' })],
          pageSize: 20,
          total: 1,
        },
      },
    });

    pageActions.upsertDocument(row('docs_a', { title: 'New title' }));

    expect(usePageStore.getState().pageDetailMap['docs_a'].title).toBe('New title');
    expect(list()?.items[0].title).toBe('New title');
  });

  it('mirrors a page the list does not hold into the by-id projection only', () => {
    usePageStore.setState({
      pageListMap: {
        [PAGE_LIST_KEY]: {
          currentPage: 0,
          hasMore: false,
          items: [],
          pageSize: 20,
          total: 0,
        },
      },
    });

    pageActions.upsertDocument(row('deep_link'));

    expect(usePageStore.getState().pageDetailMap['deep_link'].id).toBe('deep_link');
    expect(list()?.items).toEqual([]);
  });
});

describe('pageActions — refresh', () => {
  it('revalidates the list entry through the scoped matcher', async () => {
    const { mutate } = await import('@/libs/swr');
    const { cacheScope } = await import('@/libs/replica');

    await pageActions.refreshDocuments();

    const matchers = vi
      .mocked(mutate)
      .mock.calls.map(([arg]) => arg)
      .filter((arg): arg is (key: unknown) => boolean => typeof arg === 'function');
    const scope = cacheScope.get();
    const matches = (key: unknown[]) => matchers.some((matcher) => matcher(key));

    expect(matches(['replica:sync', 'pageList', 1, scope, PAGE_LIST_KEY, { pageSize: 20 }])).toBe(
      true,
    );
    expect(matches(['replica:sync', 'pageList', 1, scope, 'another-entry', {}])).toBe(false);
  });

  it('refreshes the list after publishing a page to the workspace', async () => {
    const { mutate } = await import('@/libs/swr');
    vi.mocked(documentService.publishDocumentToWorkspace).mockResolvedValue({ documentIds: [] });

    const result = await pageActions.publishPageToWorkspace('docs_a');

    expect(result).toEqual({ documentIds: [] });
    expect(mutate).toHaveBeenCalled();
  });
});
