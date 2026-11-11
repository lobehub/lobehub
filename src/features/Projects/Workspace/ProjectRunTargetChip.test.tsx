import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProjectRunTargetChip from './ProjectRunTargetChip';

const mocks = vi.hoisted(() => ({
  agency: {
    agencyConfig: undefined as
      { executionTarget?: string; heterogeneousProvider?: { type: string } } | undefined,
    canDisplayExecutionTarget: true,
    canSelectExecutionTarget: true,
    workspaceScoped: false,
  },
  selectExecutionTarget: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

// The real menu opens on hover behind a portal; render its items inline so the
// cloud-switch action is reachable from the chip itself.
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DropdownMenu: ({
    children,
    items,
  }: {
    children: ReactNode;
    items?: { key: string; label: ReactNode; onClick?: () => void }[];
  }) => (
    <div>
      {children}
      {items?.map((item) => (
        <button
          data-testid={`run-target-menu-${item.key}`}
          key={item.key}
          type={'button'}
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => mocks.agency,
}));

vi.mock('@/helpers/gatewayMode', () => ({ useIsGatewayModeEnabled: () => false }));

vi.mock('@/features/ChatInput/hooks/useSelectExecutionTarget', () => ({
  useSelectExecutionTarget: () => mocks.selectExecutionTarget,
}));

/** A device pick: resolvable everywhere, so the chip is not on the sandbox. */
const devicePick = (type?: string) => ({
  boundDeviceId: 'device_1',
  executionTarget: 'device',
  ...(type ? { heterogeneousProvider: { type } } : {}),
});

beforeEach(() => {
  mocks.agency.agencyConfig = undefined;
  mocks.selectExecutionTarget.mockReset();
  mocks.selectExecutionTarget.mockResolvedValue(true);
});

describe('ProjectRunTargetChip', () => {
  it('does not offer the cloud switch to a device-only provider', () => {
    // Amp has no sandbox toolchain: `resolveExecutionTarget` would coerce a
    // stored sandbox target back to `none`, stripping the working device pick.
    mocks.agency.agencyConfig = devicePick('amp');

    render(<ProjectRunTargetChip agentId={'agent_1'} />);

    expect(screen.getByTestId('project-run-target-chip')).toBeDisabled();
    expect(screen.queryByTestId('run-target-menu-sandbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('project-run-target-chip'));

    expect(mocks.selectExecutionTarget).not.toHaveBeenCalled();
  });

  it('keeps the cloud switch for a sandbox-capable provider', () => {
    mocks.agency.agencyConfig = devicePick('claude-code');

    render(<ProjectRunTargetChip agentId={'agent_1'} />);

    expect(screen.getByTestId('project-run-target-chip')).toBeEnabled();

    fireEvent.click(screen.getByTestId('run-target-menu-sandbox'));

    expect(mocks.selectExecutionTarget).toHaveBeenCalledWith('sandbox');
  });

  it('keeps the cloud switch for an ordinary agent', () => {
    mocks.agency.agencyConfig = devicePick();

    render(<ProjectRunTargetChip agentId={'agent_1'} />);

    expect(screen.getByTestId('project-run-target-chip')).toBeEnabled();

    fireEvent.click(screen.getByTestId('run-target-menu-sandbox'));

    expect(mocks.selectExecutionTarget).toHaveBeenCalledWith('sandbox');
  });
});
