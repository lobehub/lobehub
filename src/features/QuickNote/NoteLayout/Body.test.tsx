import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useQuickNoteStore } from '@/store/quickNote';

import Body from './Body';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../NoteList/Item', () => ({ default: ({ noteId }: { noteId: string }) => noteId }));
vi.mock('../useCreateNote', () => ({ useCreateNote: () => vi.fn() }));

const note = { collection: null, content: 'groceries', createdAt: 1, id: 'note-1', tags: [] };

beforeEach(() => {
  useQuickNoteStore.setState({
    activeCollection: null,
    activeTag: null,
    notes: [note] as never,
    notesHasMore: true,
    notesInit: true,
    notesLoadError: undefined,
    searchKeywords: '',
  } as never);
});

/** @example Filters run over loaded pages, so an empty result must still reach older pages. */
describe('Quick Note sidebar body', () => {
  // ROOT CAUSE:
  // With cursor pagination, a search that matched nothing on the loaded pages rendered only the
  // empty state, hiding "Load more" although the match could be on an unloaded page.
  it('keeps Load more reachable when a search finds nothing in loaded notes', () => {
    useQuickNoteStore.setState({ searchKeywords: 'moshi' });

    render(<Body />);

    /** @example The copy says older notes may still match. */
    expect(screen.getByText('list.emptyLoaded')).toBeInTheDocument();
    /** @example The next page can still be loaded. */
    expect(screen.getByText('list.loadMore')).toBeInTheDocument();
  });

  /** @example A collection filter with no loaded match also offers older pages. */
  it('keeps Load more reachable for an empty collection filter', () => {
    useQuickNoteStore.setState({ activeCollection: 'Work' });

    render(<Body />);

    expect(screen.getByText('list.emptyLoaded')).toBeInTheDocument();
    expect(screen.getByText('list.loadMore')).toBeInTheDocument();
  });

  /** @example Once every page is loaded, the plain no-match copy returns. */
  it('shows the plain empty search result when no pages remain', () => {
    useQuickNoteStore.setState({ notesHasMore: false, searchKeywords: 'moshi' });

    render(<Body />);

    expect(screen.getByText('list.empty')).toBeInTheDocument();
    expect(screen.queryByText('list.loadMore')).not.toBeInTheDocument();
  });
});
