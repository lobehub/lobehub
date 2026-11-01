import type { DeviceListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getDeviceListState, isListableDevice } from './deviceListState';

describe('getDeviceListState', () => {
  it('keeps an empty device result in loading state while the request is in flight', () => {
    expect(getDeviceListState({ hasDevices: false, isConfirmed: true, isFetching: true })).toBe(
      'loading',
    );
  });

  it('reports empty only after the server confirmed the list', () => {
    expect(getDeviceListState({ hasDevices: false, isConfirmed: true, isFetching: false })).toBe(
      'empty',
    );
  });

  it('keeps an unconfirmed stored copy without rows loading while no request has failed', () => {
    expect(getDeviceListState({ hasDevices: false, isConfirmed: false, isFetching: false })).toBe(
      'loading',
    );
  });

  it('keeps cached devices visible during revalidation', () => {
    expect(getDeviceListState({ hasDevices: true, isConfirmed: false, isFetching: true })).toBe(
      'ready',
    );
  });
});

describe('getDeviceListState when the request fails', () => {
  it('reports an error, not an endless skeleton, for an unconfirmed pool without rows', () => {
    expect(
      getDeviceListState({
        error: new Error('network down'),
        hasDevices: false,
        isConfirmed: false,
        isFetching: false,
      }),
    ).toBe('error');
  });

  it('shows a retry in flight as loading', () => {
    expect(
      getDeviceListState({
        error: new Error('network down'),
        hasDevices: false,
        isConfirmed: false,
        isFetching: true,
      }),
    ).toBe('loading');
  });
});

describe('isListableDevice', () => {
  const personal = { deviceId: 'dev_p', scope: 'personal' } as DeviceListItem;
  const shared = { deviceId: 'dev_w', scope: 'workspace' } as DeviceListItem;

  it('keeps personal devices out of a workspace', () => {
    expect(isListableDevice(personal, true)).toBe(false);
    expect(isListableDevice(shared, true)).toBe(true);
  });

  it('lists every device outside a workspace', () => {
    expect(isListableDevice(personal, false)).toBe(true);
  });
});
