import type * as BaseUI from '@lobehub/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TerminalPanelToggle from './index';

const mocks = vi.hoisted(() => ({
  showTerminalPanel: false,
  toggleTerminalPanel: vi.fn(),
  visible: true,
}));

const actionIconPropsSpy = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof BaseUI>();
  return {
    ...actual,
    ActionIcon: (props: ComponentProps<typeof actual.ActionIcon>) => {
      actionIconPropsSpy(props);
      return <actual.ActionIcon {...props} />;
    },
  };
});

// Where the entry shows is `useTerminalEntry`'s call (tested beside it); the
// header only renders what it answers.
vi.mock('@/features/ChatTerminal/useTerminalEntry', () => ({
  useTerminalEntry: () => mocks.visible,
}));

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
    mocks.visible = true;
    mocks.toggleTerminalPanel.mockReset();
    actionIconPropsSpy.mockClear();
  });

  it('toggles the panel and reflects its active state', () => {
    const { rerender } = render(<TerminalPanelToggle />);

    expect(actionIconPropsSpy).toHaveBeenCalledWith(expect.objectContaining({ active: false }));

    fireEvent.click(screen.getByRole('button'));
    expect(mocks.toggleTerminalPanel).toHaveBeenCalledTimes(1);
    expect(mocks.toggleTerminalPanel).toHaveBeenCalledWith();

    mocks.showTerminalPanel = true;
    actionIconPropsSpy.mockClear();
    rerender(<TerminalPanelToggle key="open" />);

    expect(actionIconPropsSpy).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
  });

  it('renders nothing where the header holds no terminal entry', () => {
    mocks.visible = false;

    render(<TerminalPanelToggle />);

    expect(screen.queryByRole('button')).toBeNull();
  });
});
