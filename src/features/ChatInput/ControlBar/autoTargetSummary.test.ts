import { describe, expect, it } from 'vitest';

import { summarizeAutoTarget } from './autoTargetSummary';

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
