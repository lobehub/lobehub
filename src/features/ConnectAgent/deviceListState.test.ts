import { describe, expect, it } from 'vitest';

import { getDeviceListState } from './deviceListState';

describe('getDeviceListState', () => {
  it('keeps an empty device result in loading state while the request is in flight', () => {
    expect(getDeviceListState({ hasDevices: false, isFetching: true })).toBe('loading');
  });

  it('reports empty only after the request settles', () => {
    expect(getDeviceListState({ hasDevices: false, isFetching: false })).toBe('empty');
  });

  it('keeps cached devices visible during revalidation', () => {
    expect(getDeviceListState({ hasDevices: true, isFetching: true })).toBe('ready');
  });
});
