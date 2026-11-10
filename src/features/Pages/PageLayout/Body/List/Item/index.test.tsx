/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PageListItem from './index';

const state = vi.hoisted(() => ({
  activeWorkspaceId: undefined as string | undefined,
  visibility: undefined as 'private' | 'public' | null | undefined,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => state.activeWorkspaceId,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => undefined,
}));

vi.mock('@/const/version', () => ({ isDesktop: false }));

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (s: { addTab: () => void }) => unknown) =>
    selector({ addTab: vi.fn() }),
}));

vi.mock('@/store/page', () => ({
  pageActions: { selectPage: vi.fn(), setRenamingPageId: vi.fn() },
  pageSelectors: {
    getDocumentById: () => () => ({
      id: 'doc-1',
      metadata: {},
      title: 'Weekly report',
      visibility: state.visibility,
    }),
  },
  usePageStore: (selector: (s: object) => unknown) =>
    selector({ renamingPageId: null, selectedPageId: null }),
}));

vi.mock('./Actions', () => ({ default: () => null }));
vi.mock('./Editing', () => ({ default: () => null }));
vi.mock('./useDropdownMenu', () => ({ useDropdownMenu: () => [] }));

describe('PageListItem visibility lock', () => {
  beforeEach(() => {
    state.activeWorkspaceId = 'ws-1';
    state.visibility = 'public';
  });

  it('marks a private workspace page with a lock', () => {
    state.visibility = 'private';
    render(<PageListItem pageId="doc-1" />);

    expect(screen.getByText('Weekly report')).toBeTruthy();
    expect(screen.getByLabelText('pageList.privateTooltip')).toBeTruthy();
  });

  it('shows no lock on a shared workspace page', () => {
    render(<PageListItem pageId="doc-1" />);

    expect(screen.queryByLabelText('pageList.privateTooltip')).toBeNull();
  });

  it('shows no lock outside a workspace', () => {
    state.activeWorkspaceId = undefined;
    state.visibility = 'private';
    render(<PageListItem pageId="doc-1" />);

    expect(screen.queryByLabelText('pageList.privateTooltip')).toBeNull();
  });
});
