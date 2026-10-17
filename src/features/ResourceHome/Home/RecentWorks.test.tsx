/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
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
  default: ({ item }: { item: { id: string } }) => <div data-testid={`card-${item.id}`} />,
}));

vi.mock('./SectionTitle', () => ({
  default: () => null,
}));

describe('RecentWorks', () => {
  it('shows only the freshest three works', () => {
    render(<RecentWorks />);

    expect(screen.getByTestId('card-wk_1')).toBeTruthy();
    expect(screen.getByTestId('card-wk_3')).toBeTruthy();
    expect(screen.queryByTestId('card-wk_4')).toBeNull();
  });
});
