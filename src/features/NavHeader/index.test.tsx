/**
 * @vitest-environment happy-dom
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearNavPanelRegistry, registerNavPanelContent } from '@/features/NavPanel/registry';

import NavHeader from './index';

const navigateMock = vi.fn();

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigateMock,
}));

vi.mock('@/features/NavPanel/useActiveNavKey', () => ({
  useActiveNavKey: () => 'memory',
}));

vi.mock('@/features/NavPanel/ToggleLeftPanelButton', () => ({
  default: () => <button aria-label={'toggle-left-panel'} />,
  isMacDesktop: false,
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: { status: { showLeftPanel: boolean } }) => unknown) =>
    selector({ status: { showLeftPanel: false } }),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    showLeftPanel: (state: { status: { showLeftPanel: boolean } }) => state.status.showLeftPanel,
  },
}));

const renderHeader = (props: Parameters<typeof NavHeader>[0] = {}) =>
  render(
    <MemoryRouter initialEntries={['/memory']}>
      <NavHeader {...props} />
    </MemoryRouter>,
  );

beforeEach(() => {
  navigateMock.mockClear();
  clearNavPanelRegistry();
  window.history.replaceState(null, '');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NavHeader on desktop', () => {
  it('keeps the left panel toggle', () => {
    renderHeader({ left: 'Memory' });

    expect(screen.getByLabelText('toggle-left-panel')).toBeInTheDocument();
    expect(screen.queryByLabelText('back')).not.toBeInTheDocument();
  });
});

describe('NavHeader on the mobile surface', () => {
  beforeEach(() => {
    vi.stubGlobal('__MOBILE__', true);
  });

  it('replaces the dead panel toggle with a back button', () => {
    renderHeader({ left: 'Memory' });

    expect(screen.queryByLabelText('toggle-left-panel')).not.toBeInTheDocument();
    expect(screen.getByLabelText('back')).toBeInTheDocument();
  });

  it('still renders the back button on a header with no other content', () => {
    renderHeader();

    expect(screen.getByLabelText('back')).toBeInTheDocument();
  });

  it('renders nothing for a content-less panel header that opts out of the toggle', () => {
    const { container } = renderHeader({ showTogglePanelButton: false });

    expect(container).toBeEmptyDOMElement();
  });

  it('goes back in history when the page was reached in-app', () => {
    window.history.replaceState({ idx: 2 }, '');
    renderHeader();

    fireEvent.click(screen.getByLabelText('back'));

    expect(navigateMock).toHaveBeenCalledWith(-1);
  });

  it('falls back to home when the page was opened directly', () => {
    renderHeader();

    fireEvent.click(screen.getByLabelText('back'));

    expect(navigateMock).toHaveBeenCalledWith('/');
  });

  it('offers the route sidebar as a drawer only once one is registered', () => {
    renderHeader({ left: 'Memory' });
    expect(screen.queryByLabelText('toggleLeftPanel.title')).not.toBeInTheDocument();

    act(() => {
      registerNavPanelContent('memory', Symbol('test'), <nav>memory sections</nav>);
    });

    fireEvent.click(screen.getByLabelText('toggleLeftPanel.title'));

    expect(screen.getByText('memory sections')).toBeInTheDocument();
  });
});
