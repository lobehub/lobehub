import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TerminalPanelToggle from './index';

const mocks = vi.hoisted(() => ({
  showTerminalPanel: false,
  toggleTerminalPanel: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ active, onClick }: { active?: boolean; onClick?: () => void }) => (
    <button data-active={String(active)} data-testid="terminal-panel-toggle" onClick={onClick} />
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/const/version', () => ({ isDesktop: true }));

vi.mock('@/store/global', () => ({
  useGlobalStore: (
    selector: (state: {
      status: { showTerminalPanel: boolean };
      toggleTerminalPanel: () => void;
    }) => unknown,
  ) =>
    selector({
      status: { showTerminalPanel: mocks.showTerminalPanel },
      toggleTerminalPanel: mocks.toggleTerminalPanel,
    }),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    showTerminalPanel: (s: { status: { showTerminalPanel: boolean } }) =>
      s.status.showTerminalPanel,
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: object) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  settingsSelectors: {
    getHotkeyById: () => () => 'ctrl+backquote',
  },
}));

describe('TerminalPanelToggle', () => {
  beforeEach(() => {
    mocks.showTerminalPanel = false;
    mocks.toggleTerminalPanel.mockReset();
  });

  it('toggles the panel and reflects its active state', () => {
    const { rerender } = render(<TerminalPanelToggle />);

    expect(screen.getByTestId('terminal-panel-toggle')).toHaveAttribute('data-active', 'false');

    fireEvent.click(screen.getByTestId('terminal-panel-toggle'));
    expect(mocks.toggleTerminalPanel).toHaveBeenCalledTimes(1);
    expect(mocks.toggleTerminalPanel).toHaveBeenCalledWith();

    mocks.showTerminalPanel = true;
    rerender(<TerminalPanelToggle key="open" />);

    expect(screen.getByTestId('terminal-panel-toggle')).toHaveAttribute('data-active', 'true');
  });
});
