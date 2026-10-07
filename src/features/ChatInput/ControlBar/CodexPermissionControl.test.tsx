import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CodexPermissionControl } from './CodexPermissionControl';

const fixture = vi.hoisted(() => ({
  confirm: vi.fn<(options: { onOk: () => Promise<void> }) => void>(),
  running: false,
  update: vi.fn(async () => {}),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: { updateAgentConfigById: typeof fixture.update }) => unknown) =>
    selector({ updateAgentConfigById: fixture.update }),
}));
vi.mock('@/store/chat', () => ({
  useChatStore: Object.assign(() => fixture.running, { getState: () => ({}) }),
}));
vi.mock('@/store/chat/selectors', () => ({
  agentRunSelectors: { isCurrentSendMessageLoading: () => fixture.running },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@lobehub/ui', () => ({
  Icon: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: fixture.confirm,
  toast: { error: vi.fn(), info: vi.fn() },
  Select: ({
    options,
    onChange,
    readOnly,
    value,
  }: {
    options: { disabled?: boolean; label: string; value: string }[];
    onChange: (value: string) => void;
    readOnly: boolean;
    value: string;
  }) => (
    <select
      aria-label="Permissions"
      disabled={readOnly}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option disabled={option.disabled} key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

/** @example A raw custom profile remains visible until the user chooses a preset. */
describe('CodexPermissionControl', () => {
  beforeEach(() => {
    fixture.confirm.mockClear();
    fixture.update.mockClear();
    fixture.running = false;
  });

  /** @example read-only/untrusted is displayed literally and Ask is persisted. */
  it('shows a custom raw policy and saves the selected preset', async () => {
    render(
      <CodexPermissionControl
        canConfigure
        supportsNativePermissions
        agentId="agent"
        provider={{ type: 'codex', args: ['--sandbox', 'read-only', '-a', 'untrusted'] }}
      />,
    );
    expect(screen.getByRole('option', { selected: true }).textContent).toBe(
      'read-only · untrusted · user',
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ask' } });
    await waitFor(() =>
      expect(fixture.update).toHaveBeenCalledWith('agent', {
        agencyConfig: {
          heterogeneousProvider: {
            type: 'codex',
            args: ['--sandbox', 'read-only', '-a', 'untrusted'],
            permissionMode: 'ask',
          },
        },
      }),
    );
  });

  // ROOT CAUSE:
  // Changing execution targets disabled the whole selector, leaving a persisted
  // local-only preset impossible to recover from on a remote target.
  /** @example Recovery requires an explicit Full access confirmation; safe modes stay unavailable. */
  it('offers remote-compatible recovery without enabling unsupported modes', async () => {
    render(
      <CodexPermissionControl
        canConfigure
        agentId="agent"
        provider={{ type: 'codex', permissionMode: 'ask' }}
        supportsNativePermissions={false}
      />,
    );
    /** @example The user can open the permission selector on a remote target. */
    expect(screen.getByRole('combobox')).not.toBeDisabled();
    /** @example Remote recovery cannot silently select an unsupported local-only mode. */
    expect(
      screen.getByRole('option', { name: 'heteroAgent.codexPermission.mode.read-only' }),
    ).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'read-only' } });
    /** @example A synthetic unsupported selection is also rejected. */
    expect(fixture.update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'full-access' } });
    /** @example Full access is never applied before explicit confirmation. */
    expect(fixture.update).not.toHaveBeenCalled();
    await act(async () => {
      await fixture.confirm.mock.calls[0][0].onOk();
    });
    /** @example Confirmed recovery persists an exact CLI-compatible profile. */
    expect(fixture.update).toHaveBeenCalledWith('agent', {
      agencyConfig: { heterogeneousProvider: { type: 'codex', permissionMode: 'full-access' } },
    });
  });

  /** @example Selecting Full access requires the explicit confirmation callback. */
  it('waits for confirmation before enabling full access', async () => {
    render(
      <CodexPermissionControl
        canConfigure
        supportsNativePermissions
        agentId="agent"
        provider={{ type: 'codex', permissionMode: 'ask' }}
      />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'full-access' } });
    expect(fixture.update).not.toHaveBeenCalled();
    expect(fixture.confirm).toHaveBeenCalledOnce();
    await act(async () => {
      await fixture.confirm.mock.calls[0][0].onOk();
    });
    expect(fixture.update).toHaveBeenCalledWith('agent', {
      agencyConfig: { heterogeneousProvider: { type: 'codex', permissionMode: 'full-access' } },
    });
  });

  // ROOT CAUSE:
  // A confirmation callback captures the idle render. A turn can start while
  // the modal remains open, so the save must read the current running state
  // before changing the policy displayed for the active session.
  /** @example A delayed Full access confirmation cannot change an active turn. */
  it('rechecks running state when a confirmation is submitted', async () => {
    render(
      <CodexPermissionControl
        canConfigure
        supportsNativePermissions
        agentId="agent"
        provider={{ type: 'codex', permissionMode: 'ask' }}
      />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'full-access' } });
    fixture.running = true;
    await act(async () => {
      await fixture.confirm.mock.calls[0][0].onOk();
    });
    /** @example The saved profile still matches the already-started native turn. */
    expect(fixture.update).not.toHaveBeenCalled();
  });

  /** @example A running turn cannot change its displayed permission selection. */
  it('disables selection while a turn is running', () => {
    fixture.running = true;
    render(
      <CodexPermissionControl
        canConfigure
        supportsNativePermissions
        agentId="agent"
        provider={{ type: 'codex', permissionMode: 'read-only' }}
      />,
    );
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
