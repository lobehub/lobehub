import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CollabBlockedBanner from './CollabBlockedBanner';

const editorState = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../store', () => ({
  usePageEditorStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(editorState.value),
}));

describe('CollabBlockedBanner', () => {
  beforeEach(() => {
    editorState.value = { collab: { access: 'edit', pending: 0, status: 'synced' } };
  });

  it('renders nothing while the room accepts edits', () => {
    const { container } = render(<CollabBlockedBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  it('tells the reader a page at its size cap is read-only', () => {
    editorState.value = {
      collab: { access: 'edit', blocked: 'too_large', pending: 0, status: 'synced' },
    };

    render(<CollabBlockedBanner />);

    expect(screen.getByText('pageEditor.collab.tooLarge.title')).toBeInTheDocument();
    expect(screen.getByText('pageEditor.collab.tooLarge.description')).toBeInTheDocument();
  });

  it('tells the reader the page was deleted', () => {
    editorState.value = {
      collab: { access: 'edit', blocked: 'deleted', pending: 0, status: 'connecting' },
    };

    render(<CollabBlockedBanner />);

    expect(screen.getByText('pageEditor.collab.deleted.title')).toBeInTheDocument();
  });

  it('warns the reader a page close to its size cap is almost full, while it stays editable', () => {
    editorState.value = {
      collab: { access: 'edit', capacity: 'near_full', pending: 0, status: 'synced' },
    };

    render(<CollabBlockedBanner />);

    expect(screen.getByText('pageEditor.collab.nearFull.title')).toBeInTheDocument();
    expect(screen.getByText('pageEditor.collab.nearFull.description')).toBeInTheDocument();
  });

  it('shows only the read-only notice once a nearly full page is blocked', () => {
    editorState.value = {
      collab: {
        access: 'edit',
        blocked: 'too_large',
        capacity: 'near_full',
        pending: 0,
        status: 'synced',
      },
    };

    render(<CollabBlockedBanner />);

    expect(screen.getByText('pageEditor.collab.tooLarge.title')).toBeInTheDocument();
    expect(screen.queryByText('pageEditor.collab.nearFull.title')).not.toBeInTheDocument();
  });
});
