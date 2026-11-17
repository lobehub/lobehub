/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TOGGLE_BUTTON_ID } from '@/features/NavPanel/ToggleLeftPanelButton';

const mocks = vi.hoisted(() => ({
  leftPanelOpen: false,
  toggleLeftPanel: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string) => key,
  }),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    showLeftPanel: () => mocks.leftPanelOpen,
  },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: any) => unknown) =>
    selector({ leftPanelOpen: mocks.leftPanelOpen, toggleLeftPanel: mocks.toggleLeftPanel }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: any) => unknown) => selector({ settings: {} }),
}));

vi.mock('@/store/user/selectors', () => ({
  settingsSelectors: { getHotkeyById: () => () => undefined },
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
    isLoadingInitial: false,
    isLoadingMore: false,
    items: [],
    loadMore: vi.fn(),
    reload: vi.fn(),
  }),
}));

vi.mock('./useOpenWork', () => ({ useOpenWork: () => vi.fn() }));

const { default: WorkGallery } = await import('./index');

describe('WorkGallery left panel toggle', () => {
  beforeEach(() => {
    mocks.leftPanelOpen = false;
    mocks.toggleLeftPanel.mockClear();
  });

  it('keeps a panel toggle on the page once the left panel is collapsed', () => {
    render(<WorkGallery galleryKey={'all'} />);

    const toggle = document.querySelector(`#${TOGGLE_BUTTON_ID}`);
    expect(toggle).not.toBeNull();

    fireEvent.click(toggle!);
    expect(mocks.toggleLeftPanel).toHaveBeenCalledTimes(1);
  });

  it('hides that header while the left panel is open, so the page keeps its layout', () => {
    mocks.leftPanelOpen = true;
    render(<WorkGallery galleryKey={'all'} />);

    expect(document.querySelector(`#${TOGGLE_BUTTON_ID}`)).toBeNull();
    expect(screen.queryByText('work.empty.title')).not.toBeNull();
  });
});
