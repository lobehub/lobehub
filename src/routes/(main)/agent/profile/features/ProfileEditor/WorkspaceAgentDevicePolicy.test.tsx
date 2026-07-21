import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WorkspaceAgentDevicePolicy from './WorkspaceAgentDevicePolicy';

const testState = vi.hoisted(() => ({
  agent: {
    agentMap: {
      'agent-1': {
        agencyConfig: {
          executionTarget: 'auto' as const,
          executionTargetSelectionPolicy: 'member' as const,
        },
        workspaceId: 'workspace-1',
      },
    },
    updateAgentConfigById: vi.fn(),
  },
  mutateDevices: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    'aria-label': ariaLabel,
    children,
    disabled,
    title,
  }: {
    'aria-label'?: string;
    'children': ReactNode;
    'disabled'?: boolean;
    'title'?: string;
  }) => (
    <button aria-label={ariaLabel} disabled={disabled} title={title} type="button">
      {children}
    </button>
  ),
  DropdownMenu: ({
    children,
    items,
  }: {
    children: ReactNode;
    items: {
      disabled?: boolean;
      key: string;
      label: ReactNode;
      onClick?: () => void;
    }[];
  }) => (
    <div>
      {children}
      <div role="menu">
        {items.map((item) => (
          <button
            disabled={item.disabled}
            key={item.key}
            role="menuitem"
            type="button"
            onClick={item.onClick}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  ),
  Select: ({
    disabled,
    loading,
    popupMatchSelectWidth,
  }: {
    disabled?: boolean;
    loading?: boolean;
    popupMatchSelectWidth?: boolean | number;
  }) => (
    <button
      data-popup-match-select-width={String(popupMatchSelectWidth)}
      disabled={disabled || loading}
      role="combobox"
    />
  ),
}));

vi.mock('@/features/DeviceManager/useDeviceList', () => ({
  useDeviceList: () => ({
    data: undefined,
    error: undefined,
    isLoading: true,
    mutate: testState.mutateDevices,
  }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof testState.agent) => unknown) =>
    selector(testState.agent),
}));

describe('WorkspaceAgentDevicePolicy', () => {
  beforeEach(() => {
    testState.agent.updateAgentConfigById.mockReset();
    testState.mutateDevices.mockReset();
  });

  it('keeps static targets and the selection policy menu interactive while saves are pending', async () => {
    let finishSave: (() => void) | undefined;
    testState.agent.updateAgentConfigById.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );

    render(<WorkspaceAgentDevicePolicy agentId="agent-1" />);

    expect(screen.getByText('settingAgent.devicePolicy.title')).toBeTruthy();
    expect(screen.queryByText('settingAgent.devicePolicy.defaultTarget')).toBeNull();
    expect(screen.queryByText('settingAgent.devicePolicy.defaultTargetDesc')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();

    const select = screen.getByRole('combobox') as HTMLButtonElement;
    const policyButton = screen.getByRole('button', {
      name: 'settingAgent.selectionPolicy.membersCanSwitch',
    }) as HTMLButtonElement;
    expect(select.disabled).toBe(false);
    expect(select.dataset.popupMatchSelectWidth).toBe('true');
    expect(policyButton.disabled).toBe(false);

    fireEvent.click(policyButton);
    fireEvent.click(
      screen.getByRole('menuitem', {
        name: 'settingAgent.selectionPolicy.membersCannotSwitch',
      }),
    );

    expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith('agent-1', {
      agencyConfig: {
        executionTarget: 'auto',
        executionTargetSelectionPolicy: 'fixed',
      },
    });

    await act(async () => finishSave?.());
  });
});
