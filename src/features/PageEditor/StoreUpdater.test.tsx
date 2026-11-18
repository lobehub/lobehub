import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore, Provider, usePageEditorStore } from './store';
import StoreUpdater from './StoreUpdater';

const performSaveMock = vi.fn();

vi.mock('@/store/document', () => ({
  useDocumentStore: { getState: () => ({ performSave: performSaveMock }) },
}));
vi.mock('@/store/page', () => ({
  pageSelectors: { getDocumentById: () => () => undefined },
  usePageStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('./useDocumentLock', () => ({ useDocumentLock: () => {} }));
vi.mock('./useResourceEvents', () => ({ useResourceEvents: () => {} }));
vi.mock('./usePageDraft', () => ({ usePageDraft: () => {} }));
vi.mock('./useReleaseAgentEdit', () => ({ useReleaseAgentEdit: () => {} }));

let typeTitle: ((title: string) => void) | undefined;
const TitleInput = () => {
  const setTitle = usePageEditorStore((s) => s.setTitle);
  useEffect(() => {
    typeTitle = setTitle;
  }, [setTitle]);
  return null;
};

const renderEditor = (pageId: string, title: string) => (
  <Provider createStore={() => createStore({ documentId: 'page-a', title: 'M11W1 本周事项' })}>
    <StoreUpdater pageId={pageId} title={title} />
    <TitleInput />
  </Provider>
);

describe('StoreUpdater - switching pages on a mounted editor (T-14156)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    performSaveMock.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves a rename still waiting in the debounce into the page it was typed on', async () => {
    const view = render(renderEditor('page-a', 'M11W1 本周事项'));

    act(() => typeTitle!('待办事项'));
    // Switch before the meta debounce fires.
    view.rerender(renderEditor('page-b', 'Other page'));
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(performSaveMock).toHaveBeenCalledTimes(1);
    expect(performSaveMock).toHaveBeenCalledWith(
      'page-a',
      expect.objectContaining({ title: '待办事项' }),
      expect.objectContaining({ metadataOnly: true }),
    );
  });

  it('does not save anything when switching without a pending rename', async () => {
    const view = render(renderEditor('page-a', 'M11W1 本周事项'));

    view.rerender(renderEditor('page-b', 'Other page'));
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(performSaveMock).not.toHaveBeenCalled();
  });
});
