/**
 * @vitest-environment happy-dom
 */
import { AccordionRoot } from '@lobehub/ui';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Favorites from './index';

const state = vi.hoisted(() => ({
  error: undefined as Error | undefined,
  list: undefined as unknown[] | undefined,
  revalidate: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/Favorites', () => ({
  useFetchFavorites: () => ({ error: state.error, revalidate: state.revalidate }),
}));
vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/home/selectors', () => ({
  favoriteSelectors: { favoriteList: () => state.list },
}));
vi.mock('@/components/AsyncError', () => ({
  default: ({ onRetry }: { onRetry: () => void }) => (
    <button type="button" onClick={onRetry}>
      retry
    </button>
  ),
}));
vi.mock('./SortableFavoriteList', () => ({ default: () => <div data-testid="favorite-list" /> }));

const renderSection = () =>
  render(
    <AccordionRoot defaultValue={['favorites']}>
      <Favorites itemKey="favorites" />
    </AccordionRoot>,
  );

describe('Favorites sidebar section', () => {
  beforeEach(() => {
    state.error = undefined;
    state.list = undefined;
    state.revalidate.mockReset();
  });

  afterEach(cleanup);

  it('shows a failed first load with a retry instead of disappearing', () => {
    state.error = new Error('offline');
    renderSection();

    expect(screen.getByText('favorite.section')).toBeTruthy();
    screen.getByText('retry').click();

    expect(state.revalidate).toHaveBeenCalled();
  });

  it('stays hidden while there is nothing favorited', () => {
    state.list = [];
    renderSection();

    expect(screen.queryByText('favorite.section')).toBeNull();
  });
});
