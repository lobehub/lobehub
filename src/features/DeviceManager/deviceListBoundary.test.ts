import type { DeviceListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { deviceDetailKey, getDeviceListBoundary } from './deviceListBoundary';

const rows = [{ deviceId: 'dev-2', scope: 'personal' }] as DeviceListItem[];

const list = (overrides: Partial<Parameters<typeof getDeviceListBoundary>[0]> = {}) => ({
  data: rows,
  error: undefined,
  isConfirmed: false,
  isLoading: false,
  isValidating: true,
  ...overrides,
});

describe('getDeviceListBoundary', () => {
  it('keeps an unconfirmed copy with nothing to show loading, not empty', () => {
    // e.g. the restored copy has no row for this pool, or misses the opened device.
    expect(getDeviceListBoundary(list(), true)).toEqual({ data: undefined, isLoading: true });
  });

  it('lets a failed refresh over an unconfirmed empty copy reach the error state', () => {
    expect(
      getDeviceListBoundary(list({ error: new Error('boom'), isValidating: false }), true),
    ).toEqual({ data: undefined, isLoading: false });
  });

  it('shows the retry in flight as loading', () => {
    expect(getDeviceListBoundary(list({ error: new Error('boom') }), true)).toEqual({
      data: undefined,
      isLoading: true,
    });
  });

  it('treats an empty result as empty once the server confirmed the list', () => {
    expect(getDeviceListBoundary(list({ isConfirmed: true, isValidating: false }), true)).toEqual({
      data: rows,
      isLoading: false,
    });
  });

  it('paints restored rows straight away', () => {
    expect(getDeviceListBoundary(list(), false)).toEqual({ data: rows, isLoading: false });
  });

  it('keeps settled rows when a background refresh fails', () => {
    expect(
      getDeviceListBoundary(
        list({ error: new Error('boom'), isConfirmed: true, isValidating: false }),
        false,
      ),
    ).toEqual({ data: rows, isLoading: false });
  });
});

describe('deviceDetailKey', () => {
  it('remounts the detail once the server confirms a stored row', () => {
    expect(deviceDetailKey('dev-1', false)).not.toBe(deviceDetailKey('dev-1', true));
  });

  it('keeps one mount across refreshes of a confirmed row', () => {
    expect(deviceDetailKey('dev-1', true)).toBe(deviceDetailKey('dev-1', true));
  });

  it('remounts when the route moves to another device', () => {
    expect(deviceDetailKey('dev-1', true)).not.toBe(deviceDetailKey('dev-2', true));
  });
});
