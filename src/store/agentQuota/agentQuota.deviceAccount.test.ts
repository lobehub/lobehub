/**
 * @vitest-environment happy-dom
 *
 * The per-device account choice: a login lives on one machine, so the Manual
 * pick is stored per device, and the desktop reports which logins it holds.
 */
import { randomUUID } from 'node:crypto';

import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { agentQuotaService } from '@/services/agentQuota';
import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';
import { useElectronStore } from '@/store/electron';

import { agentQuotaSelectors, useAgentQuotaStore } from './index';
import { initialState } from './initialState';

beforeEach(() => {
  const scope = `quota-device-${randomUUID()}:personal`;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  act(() => useAgentQuotaStore.setState(initialState, false));
  vi.spyOn(agentQuotaService, 'listBindings').mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('per-device account choice', () => {
  it('saves a pick for one device and re-reads it with the bindings it moved', async () => {
    const getDeviceAccount = vi
      .spyOn(agentQuotaService, 'getDeviceAccount')
      .mockResolvedValueOnce({ accountId: null, signedInAccountIds: ['acc-1'] })
      .mockResolvedValue({ accountId: 'acc-1', signedInAccountIds: ['acc-1'] });
    const setDeviceAccount = vi
      .spyOn(agentQuotaService, 'setDeviceAccount')
      .mockResolvedValue(undefined as never);

    await act(() =>
      useAgentQuotaStore.getState().setQuotaDeviceAccount('agent-1', 'device-a', 'acc-1'),
    );

    expect(setDeviceAccount).toHaveBeenCalledWith('agent-1', 'device-a', 'acc-1');
    expect(getDeviceAccount).toHaveBeenLastCalledWith('agent-1', 'device-a');
    expect(agentQuotaService.listBindings).toHaveBeenCalledWith('agent-1');
    expect(
      agentQuotaSelectors.deviceAccount('agent-1', 'device-a')(useAgentQuotaStore.getState()),
    ).toEqual({ accountId: 'acc-1', signedInAccountIds: ['acc-1'] });
    expect(
      agentQuotaSelectors.deviceAccount('agent-1', 'device-b')(useAgentQuotaStore.getState()),
    ).toBeUndefined();
  });

  // The manager lists only the accounts the device holds a login for; a pick
  // in flight must not empty that list until the server answers.
  it('keeps the device’s logins listed while a pick is being saved', async () => {
    vi.spyOn(agentQuotaService, 'getDeviceAccount').mockResolvedValue({
      accountId: null,
      signedInAccountIds: ['acc-1', 'acc-2'],
    });
    let finishWrite!: () => void;
    vi.spyOn(agentQuotaService, 'setDeviceAccount').mockImplementation(
      () => new Promise<void>((resolve) => (finishWrite = resolve)) as never,
    );
    const deviceAccount = () =>
      agentQuotaSelectors.deviceAccount('agent-1', 'device-a')(useAgentQuotaStore.getState());

    await act(() => useAgentQuotaStore.getState().readQuotaDeviceAccount('agent-1', 'device-a'));
    let saving!: Promise<void>;
    act(() => {
      saving = useAgentQuotaStore.getState().setQuotaDeviceAccount('agent-1', 'device-a', 'acc-2');
    });

    await vi.waitFor(() =>
      expect(deviceAccount()).toEqual({
        accountId: 'acc-2',
        signedInAccountIds: ['acc-1', 'acc-2'],
      }),
    );
    await act(async () => {
      finishWrite();
      await saving;
    });
  });

  it('reports every local login for this desktop after listing them', async () => {
    vi.spyOn(heterogeneousAgentService, 'listClaudeCodeAccounts').mockResolvedValue([
      { configDir: null, identity: { externalAccountId: 'ext-default' } },
      { configDir: '/profiles/two', identity: { externalAccountId: 'ext-2' } },
    ] as never);
    vi.spyOn(heterogeneousAgentService, 'getClaudeCodeQuota').mockResolvedValue(null as never);
    vi.spyOn(agentQuotaService, 'listAccounts').mockResolvedValue([]);
    vi.spyOn(agentQuotaService, 'ingestClaudeSnapshot').mockResolvedValue({} as never);
    vi.spyOn(useElectronStore.getState(), 'resolveGatewayDeviceId').mockResolvedValue('device-a');
    const syncDeviceLogins = vi
      .spyOn(agentQuotaService, 'syncDeviceLogins')
      .mockResolvedValue(undefined as never);

    await useAgentQuotaStore.getState().refreshClaudeLocalAccounts();

    expect(syncDeviceLogins).toHaveBeenCalledWith('device-a', 'claude-code', [
      'ext-default',
      'ext-2',
    ]);
  });

  // Regression: signing out removed the pick on the server, but the manager
  // opened right after still showed it until it was reopened.
  it('re-reads the picks on screen for this desktop once its logins are reported', async () => {
    vi.spyOn(heterogeneousAgentService, 'listClaudeCodeAccounts').mockResolvedValue([]);
    vi.spyOn(agentQuotaService, 'listAccounts').mockResolvedValue([]);
    vi.spyOn(useElectronStore.getState(), 'resolveGatewayDeviceId').mockResolvedValue('device-a');
    vi.spyOn(agentQuotaService, 'syncDeviceLogins').mockResolvedValue(undefined as never);
    const getDeviceAccount = vi
      .spyOn(agentQuotaService, 'getDeviceAccount')
      .mockResolvedValueOnce({ accountId: 'acc-gone', signedInAccountIds: ['acc-gone'] })
      .mockResolvedValue({ accountId: null, signedInAccountIds: [] });

    await useAgentQuotaStore.getState().readQuotaDeviceAccount('agent-1', 'device-a');
    expect(
      agentQuotaSelectors.deviceAccount('agent-1', 'device-a')(useAgentQuotaStore.getState()),
    ).toEqual({ accountId: 'acc-gone', signedInAccountIds: ['acc-gone'] });

    await useAgentQuotaStore.getState().refreshClaudeLocalAccounts();

    expect(getDeviceAccount).toHaveBeenCalledTimes(2);
    expect(
      agentQuotaSelectors.deviceAccount('agent-1', 'device-a')(useAgentQuotaStore.getState()),
    ).toEqual({ accountId: null, signedInAccountIds: [] });
  });
});
