import type { DeviceListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { autoDispatchPool, summarizeAutoTarget } from './autoTargetSummary';

const device = (id: string, online: boolean, onlineUnknown?: boolean) => ({
  deviceId: id,
  online,
  onlineUnknown,
});

describe('summarizeAutoTarget', () => {
  it('names the one online device, which an auto run uses directly', () => {
    const mac = device('mac', true);

    expect(summarizeAutoTarget({ isConfirmed: true, pool: [mac, device('pc', false)] })).toEqual({
      device: mac,
      kind: 'single',
    });
  });

  it('says the Agent picks when several devices are online', () => {
    expect(
      summarizeAutoTarget({ isConfirmed: true, pool: [device('a', true), device('b', true)] }),
    ).toEqual({ kind: 'multiple' });
  });

  it('says nothing is online, including for an empty pool', () => {
    expect(summarizeAutoTarget({ isConfirmed: true, pool: [device('a', false)] })).toEqual({
      kind: 'none',
    });
    expect(summarizeAutoTarget({ isConfirmed: true, pool: [] })).toEqual({ kind: 'none' });
  });

  // A stored copy's `online: false` is a placeholder: claiming "no device
  // online" from it would contradict the run a moment later.
  it('stays pending until the list and every presence are confirmed', () => {
    expect(summarizeAutoTarget({ isConfirmed: false, pool: [device('a', true)] })).toEqual({
      kind: 'pending',
    });
    expect(summarizeAutoTarget({ isConfirmed: true, pool: [device('a', false, true)] })).toEqual({
      kind: 'pending',
    });
  });
});

describe('autoDispatchPool', () => {
  const row = (deviceId: string, scope: 'personal' | 'workspace') =>
    ({ deviceId, online: true, scope, visibility: 'public' }) as DeviceListItem;
  const laptop = row('laptop', 'personal');
  const shared = row('shared', 'workspace');
  const devices = [laptop, shared];

  it('adds the bound personal device to a workspace agent pool, as dispatch does', () => {
    expect(autoDispatchPool({ boundDeviceId: 'laptop', devices, isWorkspaceAgent: true })).toEqual([
      shared,
      laptop,
    ]);
  });

  it('keeps the workspace pool alone without a personal binding', () => {
    expect(autoDispatchPool({ devices, isWorkspaceAgent: true })).toEqual([shared]);
    expect(autoDispatchPool({ boundDeviceId: 'shared', devices, isWorkspaceAgent: true })).toEqual([
      shared,
    ]);
    expect(autoDispatchPool({ boundDeviceId: 'gone', devices, isWorkspaceAgent: true })).toEqual([
      shared,
    ]);
  });

  it('uses the personal pool for a personal agent', () => {
    expect(autoDispatchPool({ boundDeviceId: 'laptop', devices, isWorkspaceAgent: false })).toEqual(
      [laptop],
    );
  });
});
