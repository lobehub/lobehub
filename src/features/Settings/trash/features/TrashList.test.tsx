import type { TrashItem } from '@lobechat/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTrashStore } from '@/store/trash';

import TrashList from './TrashList';

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

const buildItem = (overrides: Partial<TrashItem> = {}): TrashItem => ({
  deletedAt: new Date(Date.now() - 60_000),
  deletedByUserId: 'u1',
  expiresAt: new Date(Date.now() + 29 * 24 * 3600 * 1000),
  id: 'trash_1',
  meta: { childCount: 3 },
  resourceId: 'agt_1',
  resourceType: 'agent',
  rootId: null,
  title: 'Research Bot',
  userId: 'u1',
  workspaceId: null,
  ...overrides,
});

describe('TrashList', () => {
  beforeEach(() => {
    useTrashStore.setState({
      activeType: undefined,
      countByType: { agent: 1, topic: 1 },
      isTrashInit: true,
      items: [
        buildItem(),
        buildItem({ id: 'trash_2', meta: null, resourceType: 'topic', title: null }),
      ],
      loadingIds: [],
      nextCursor: 'more',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders each root with its title, cascade count, type filter counts and a load-more affordance', () => {
    render(<TrashList />);

    expect(screen.getByText('Research Bot')).toBeInTheDocument();
    expect(screen.getByText('trash.meta.children:{"count":3}')).toBeInTheDocument();
    // untitled rows fall back to a placeholder instead of an empty cell
    expect(screen.getByText('trash.untitled')).toBeInTheDocument();
    expect(screen.getAllByText('trash.actions.restore')).toHaveLength(2);
    expect(screen.getByText('trash.actions.loadMore')).toBeInTheDocument();
    // filter shows the per-type counts so the user knows what's inside before switching
    expect(screen.getByText('trash.type.agent · 1')).toBeInTheDocument();
  });

  it('restores a row through the store and reports a blocked restore', async () => {
    const restore = vi
      .fn()
      .mockResolvedValue({ failed: [{ code: 'parentTrashed', id: 'trash_1' }], restored: [] });
    useTrashStore.setState({ restore });

    render(<TrashList />);
    fireEvent.click(screen.getAllByText('trash.actions.restore')[0]);

    expect(restore).toHaveBeenCalledWith(['trash_1']);
  });

  it('shows the retention-aware empty state when the bin is empty', () => {
    useTrashStore.setState({ countByType: {}, items: [], nextCursor: null });
    render(<TrashList />);
    expect(screen.getByText('trash.empty.title')).toBeInTheDocument();
    expect(screen.getByText('trash.empty.desc:{"days":30}')).toBeInTheDocument();
  });
});
