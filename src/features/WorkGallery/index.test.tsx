/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isLoadingInitial: false }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string) => key,
  }),
}));

// The gallery's only chrome outside the cards is the content-side header that
// hosts the left panel toggle; the toggle itself is covered by the NavHeader
// tests (`getNavHeaderLeading`), so the page only has to keep it mounted.
vi.mock('@/features/NavHeader', () => ({
  default: () => <div data-testid={'works-nav-header'} />,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('@/business/client/features/ResourceCategories', () => ({
  useBusinessResourceCategories: () => [],
}));

vi.mock('@/features/AgentTasks/shared/useAgentDisplayMeta', () => ({
  useAgentDisplayMeta: () => undefined,
}));

vi.mock('@/features/CanvasStorage/useCanvasStorage', () => ({
  summarizeCanvasStorage: () => ({ byCanvas: new Map() }),
  useFetchCanvasStorage: () => ({ data: undefined }),
}));

vi.mock('@/hooks/useFetchAgentList', () => ({ useFetchAgentList: () => undefined }));

vi.mock('./hooks', () => ({
  useWorkspaceWorksInfinite: () => ({
    error: undefined,
    hasMore: false,
    isLoadingInitial: mocks.isLoadingInitial,
    isLoadingMore: false,
    items: [],
    loadMore: vi.fn(),
    reload: vi.fn(),
  }),
}));

vi.mock('./useOpenWork', () => ({ useOpenWork: () => vi.fn() }));

const { default: WorkGallery } = await import('./index');

describe('WorkGallery page chrome', () => {
  beforeEach(() => {
    mocks.isLoadingInitial = false;
  });

  it('renders the content side header that keeps the left panel toggle reachable', () => {
    render(<WorkGallery galleryKey={'all'} />);

    expect(screen.getByTestId('works-nav-header')).toBeTruthy();
  });

  it('keeps that header while the gallery is still loading', () => {
    mocks.isLoadingInitial = true;
    render(<WorkGallery galleryKey={'all'} />);

    expect(screen.getByTestId('works-nav-header')).toBeTruthy();
  });
});
