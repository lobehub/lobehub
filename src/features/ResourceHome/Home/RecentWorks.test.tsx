/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import RecentWorks from './RecentWorks';

const mocks = vi.hoisted(() => ({
  openWork: vi.fn(),
  reload: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/WorkGallery/hooks', () => ({
  useWorkspaceWorksInfinite: () => ({
    error: undefined,
    isLoadingInitial: false,
    items: [{ id: 'wk_1' }, { id: 'wk_2' }, { id: 'wk_3' }, { id: 'wk_4' }],
    reload: mocks.reload,
  }),
}));

vi.mock('@/features/WorkGallery/useOpenWork', () => ({
  useOpenWork: () => mocks.openWork,
}));

vi.mock('@/features/WorkGallery/WorkPreviewCard', () => ({
  default: ({ item, onRemoved }: { item: { id: string }; onRemoved?: () => void }) => (
    <button data-testid={`card-${item.id}`} type="button" onClick={() => onRemoved?.()}>
      {item.id}
    </button>
  ),
}));

vi.mock('./SectionTitle', () => ({
  default: () => null,
}));

describe('RecentWorks', () => {
  it('refreshes its own infinite list after a card is removed', () => {
    render(<RecentWorks />);

    // Only the freshest three are shown on the dashboard.
    expect(screen.queryByTestId('card-wk_4')).toBeNull();

    // The global Work refresh in `useRemoveWork` skips `useSWRInfinite` keys,
    // so the card has to be handed this list's own `reload`.
    fireEvent.click(screen.getByTestId('card-wk_1'));
    expect(mocks.reload).toHaveBeenCalledTimes(1);
  });
});
