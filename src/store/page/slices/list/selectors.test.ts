import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentSourceType, type LobeDocument } from '@/types/document';

import { initialState, type PageState } from '../../initialState';
import { PAGE_LIST_KEY } from '../../projection';
import { listSelectors } from './selectors';

vi.mock('@/store/global', () => ({
  useGlobalStore: {
    getState: () => ({
      status: { pagePageSize: 20 },
    }),
  },
}));

const doc = (
  id: string,
  visibility: LobeDocument['visibility'],
  overrides: Partial<LobeDocument> = {},
): LobeDocument => ({
  content: null,
  createdAt: new Date(overrides.createdAt ?? '2026-01-01T00:00:00.000Z'),
  editorData: null,
  fileType: 'custom/document',
  filename: id,
  id,
  metadata: {},
  source: 'document',
  sourceType: DocumentSourceType.EDITOR,
  title: id,
  totalCharCount: 0,
  totalLineCount: 0,
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  visibility,
  workspaceId: 'ws-1',
  ...overrides,
});

const createState = (documents: LobeDocument[], overrides: Partial<PageState> = {}): PageState => ({
  ...initialState,
  pageListMap: {
    [PAGE_LIST_KEY]: {
      currentPage: 0,
      hasMore: false,
      items: documents,
      pageSize: 20,
      total: documents.length,
    },
  },
  searchKeywords: '',
  ...overrides,
});

describe('listSelectors — private/workspace buckets', () => {
  let state: PageState;

  beforeEach(() => {
    state = createState([
      doc('priv-a', 'private'),
      doc('priv-b', 'private'),
      doc('pub-a', 'public'),
      doc('pub-b', null),
      doc('pub-c', undefined),
    ]);
  });

  it('routes private-visibility docs into the private bucket', () => {
    const ids = listSelectors.getPrivateFilteredDocuments(state).map((d) => d.id);
    expect(ids.sort()).toEqual(['priv-a', 'priv-b']);
  });

  it('routes non-private docs (public/null/undefined) into the workspace bucket', () => {
    // null and undefined visibility fall back to workspace-shared so historical
    // docs pre-dating the column stay visible to every member.
    const ids = listSelectors.getWorkspaceFilteredDocuments(state).map((d) => d.id);
    expect(ids.sort()).toEqual(['pub-a', 'pub-b', 'pub-c']);
  });

  it('exposes bucket counts', () => {
    expect(listSelectors.privateFilteredDocumentsCount(state)).toBe(2);
    expect(listSelectors.workspaceFilteredDocumentsCount(state)).toBe(3);
  });

  it('honors the existing sourceType filter (drops file-uploaded docs from both buckets)', () => {
    const stateWithFile = createState([
      doc('priv-page', 'private'),
      doc('priv-file', 'private', { sourceType: 'file' as DocumentSourceType }),
      doc('pub-page', 'public'),
      doc('pub-file', 'public', { sourceType: 'file' as DocumentSourceType }),
    ]);

    expect(listSelectors.getPrivateFilteredDocuments(stateWithFile).map((d) => d.id)).toEqual([
      'priv-page',
    ]);
    expect(listSelectors.getWorkspaceFilteredDocuments(stateWithFile).map((d) => d.id)).toEqual([
      'pub-page',
    ]);
  });

  it('respects the sidebar page size cap for each bucket independently', () => {
    const many = Array.from({ length: 25 }).map((_, i) =>
      doc(`priv-${i}`, 'private', { createdAt: new Date(`2026-01-${(i % 28) + 1}`) }),
    );
    const state = createState(many);
    expect(listSelectors.getPrivateFilteredDocumentsLimited(state)).toHaveLength(20);
    expect(listSelectors.hasMorePrivateFilteredDocuments(state)).toBe(true);
  });
});

describe('listSelectors — replica-backed reads', () => {
  it('reports the list as uninitialized until the entry has a value', () => {
    const empty = { ...initialState, searchKeywords: '' } as PageState;

    expect(listSelectors.isPageListInit(empty)).toBe(false);
    expect(listSelectors.isDocumentsLoading(empty)).toBe(true);
    expect(listSelectors.getFilteredDocuments(empty)).toEqual([]);
    expect(listSelectors.documentsTotal(empty)).toBe(0);

    const loaded = createState([doc('page-a', 'public')]);

    expect(listSelectors.isPageListInit(loaded)).toBe(true);
    expect(listSelectors.isDocumentsLoading(loaded)).toBe(false);
    expect(listSelectors.documentsTotal(loaded)).toBe(1);
  });

  it('reads pagination flags from the paged view', () => {
    const state = createState([doc('page-a', 'public')], {
      pageListMap: {
        [PAGE_LIST_KEY]: {
          currentPage: 1,
          hasMore: true,
          isLoadingMore: true,
          items: [doc('page-a', 'public')],
          pageSize: 20,
          total: 42,
        },
      },
    });

    expect(listSelectors.hasMoreDocuments(state)).toBe(true);
    expect(listSelectors.isLoadingMoreDocuments(state)).toBe(true);
    expect(listSelectors.documentsTotal(state)).toBe(42);
  });

  it('resolves a page from the list, falling back to the by-id projection', () => {
    const state = createState([doc('in-list', 'private')], {
      pageDetailMap: { 'deep-link': doc('deep-link', 'public', { title: 'Deep linked' }) },
    });

    expect(listSelectors.getDocumentById('in-list')(state)?.id).toBe('in-list');
    expect(listSelectors.getDocumentById('deep-link')(state)?.title).toBe('Deep linked');
    // A page that is in neither location resolves to nothing.
    expect(listSelectors.getDocumentById('missing')(state)).toBeUndefined();
    expect(listSelectors.getDocumentById(undefined)(state)).toBeUndefined();
  });

  it('prefers the list copy over the by-id projection for the same page', () => {
    const state = createState([doc('same-page', 'private', { title: 'From list' })], {
      pageDetailMap: { 'same-page': doc('same-page', 'private', { title: 'From detail' }) },
    });

    expect(listSelectors.getDocumentById('same-page')(state)?.title).toBe('From list');
  });
});
