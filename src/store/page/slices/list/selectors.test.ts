import { describe, expect, it, vi } from 'vitest';

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

describe('listSelectors — workspace visibility', () => {
  it('keeps private and shared pages in one list', () => {
    const state = createState([
      doc('priv-a', 'private', { createdAt: new Date('2026-01-03') }),
      doc('pub-a', 'public', { createdAt: new Date('2026-01-02') }),
      doc('legacy', null, { createdAt: new Date('2026-01-01') }),
    ]);

    expect(listSelectors.getFilteredDocuments(state).map((d) => d.id)).toEqual([
      'priv-a',
      'pub-a',
      'legacy',
    ]);
    expect(listSelectors.filteredDocumentsCount(state)).toBe(3);
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

  it('resolves a page that only a Docs sidebar section has loaded', () => {
    // Fresh Docs load: the section rendered the row, the flat list has not.
    const state = createState([], {
      pageSectionMap: {
        mine: [doc('section-only', 'private', { title: 'Section only' })],
      },
    });

    expect(listSelectors.getDocumentById('section-only')(state)?.title).toBe('Section only');
  });

  it('prefers the list and by-id copies over a section row', () => {
    const state = createState([doc('everywhere', 'private', { title: 'From list' })], {
      pageDetailMap: { 'deep-link': doc('deep-link', 'private', { title: 'From detail' }) },
      pageSectionMap: {
        mine: [
          doc('everywhere', 'private', { title: 'From section' }),
          doc('deep-link', 'private', { title: 'From section' }),
        ],
      },
    });

    expect(listSelectors.getDocumentById('everywhere')(state)?.title).toBe('From list');
    expect(listSelectors.getDocumentById('deep-link')(state)?.title).toBe('From detail');
  });
});
