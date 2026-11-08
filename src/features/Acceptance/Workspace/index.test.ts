import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import AcceptanceEmptyDetail from './EmptyDetail';
import AcceptanceWorkspace, { shouldShowAcceptanceOnboarding } from './index';

const { panel, listRead } = vi.hoisted(() => ({
  listRead: vi.fn<(enabled: boolean, options: unknown) => object>(() => ({})),
  panel: { expand: true, isNarrow: false, pinned: true, setExpand: vi.fn() },
}));

vi.mock('../hooks', () => ({ useAcceptanceList: listRead }));
vi.mock('./useReportPanelExpand', () => ({ useReportPanelExpand: () => panel }));
vi.mock('./AcceptanceListPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'private-list' }),
}));
vi.mock('./AcceptanceProjectActions', () => ({ useAcceptanceProjectActionItems: () => vi.fn() }));
vi.mock('@/features/RouteMeta', () => ({ RouteMetaBridge: () => null }));
vi.mock('@/features/PageShell', () => ({
  ShellTopBar: ({ titleExtra }: { titleExtra?: ReactNode }) =>
    createElement('header', null, titleExtra),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useUserStore.setState({ isSignedIn: undefined });
});

describe('AcceptanceWorkspace public access', () => {
  const renderWorkspace = (path = '/acceptance/public-report') =>
    render(
      createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(
          Routes,
          null,
          createElement(
            Route,
            { element: createElement(AcceptanceWorkspace), path: '/acceptance' },
            createElement(Route, { element: createElement(AcceptanceEmptyDetail), index: true }),
            createElement(Route, {
              element: createElement('main', null, 'Public report'),
              path: ':acceptanceId',
            }),
          ),
        ),
      ),
    );

  it.each([
    { isNarrow: false, pinned: true },
    { isNarrow: false, pinned: false },
    { isNarrow: true, pinned: true },
  ])('does not mount private lists for guests in layout %j', (layout) => {
    Object.assign(panel, layout);
    useUserStore.setState({ isSignedIn: false });
    renderWorkspace();

    expect(screen.getByText('Public report')).toBeInTheDocument();
    expect(screen.queryByTestId('private-list')).not.toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeEmptyDOMElement();
    expect(listRead.mock.calls.every(([enabled]) => !enabled)).toBe(true);
  });

  it('waits for sign-in before mounting the list and removes it on sign-out', () => {
    Object.assign(panel, { isNarrow: false, pinned: true });
    useUserStore.setState({ isSignedIn: undefined });
    renderWorkspace();

    expect(screen.queryByTestId('private-list')).not.toBeInTheDocument();
    act(() => useUserStore.setState({ isSignedIn: true }));
    expect(screen.getByTestId('private-list')).toBeInTheDocument();
    act(() => useUserStore.setState({ isSignedIn: false }));
    expect(screen.queryByTestId('private-list')).not.toBeInTheDocument();
    expect(screen.getByText('Public report')).toBeInTheDocument();
  });

  it('offers sign-in instead of a hidden menu on the anonymous collection index', () => {
    useUserStore.setState({ isSignedIn: false });
    renderWorkspace('/acceptance');

    expect(listRead.mock.calls.every(([enabled]) => !enabled)).toBe(true);
    expect(
      screen.getByText('acceptance.workspace.emptyDetail.signInDescription'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('acceptance.workspace.emptyDetail.description'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('auth:login')).toHaveAttribute(
      'href',
      '/signin?callbackUrl=%2Facceptance',
    );
  });

  it('keeps collection guidance for members without prompting during unresolved auth', () => {
    useUserStore.setState({ isSignedIn: undefined });
    renderWorkspace('/acceptance');
    expect(screen.queryByText('auth:login')).not.toBeInTheDocument();

    act(() => useUserStore.setState({ isSignedIn: true }));
    expect(screen.getByText('acceptance.workspace.emptyDetail.description')).toBeInTheDocument();
    expect(screen.queryByText('auth:login')).not.toBeInTheDocument();
    expect(listRead.mock.calls.some(([enabled]) => enabled)).toBe(true);
  });
});

describe('shouldShowAcceptanceOnboarding', () => {
  it('uses the full-page onboarding only after the complete list resolves empty', () => {
    expect(shouldShowAcceptanceOnboarding({ data: [], enabled: true, isLoading: false })).toBe(
      true,
    );
    expect(shouldShowAcceptanceOnboarding({ data: [{}], enabled: true, isLoading: false })).toBe(
      false,
    );
    expect(shouldShowAcceptanceOnboarding({ data: [], enabled: true, isLoading: true })).toBe(
      false,
    );
    expect(
      shouldShowAcceptanceOnboarding({
        data: [],
        enabled: true,
        error: new Error('network'),
        isLoading: false,
      }),
    ).toBe(false);
    expect(shouldShowAcceptanceOnboarding({ data: [], enabled: false, isLoading: false })).toBe(
      false,
    );
  });

  it('never swallows a deep-linked acceptance behind the onboarding, even with an empty own list', () => {
    expect(
      shouldShowAcceptanceOnboarding({
        data: [],
        enabled: true,
        hasDeepLink: true,
        isLoading: false,
      }),
    ).toBe(false);
  });
});
