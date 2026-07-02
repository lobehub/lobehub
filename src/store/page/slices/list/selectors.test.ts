import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentSourceType, type LobeDocument } from '@/types/document';

import { initialState, type PageState } from '../../initialState';
import { initialListState } from './initialState';
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

const createState = (documents: LobeDocument[]): PageState => ({
  ...initialState,
  ...initialListState,
  documents,
  searchKeywords: '',
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
