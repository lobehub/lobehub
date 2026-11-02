import { describe, expect, it } from 'vitest';

import { getBoundDevicePresence, getDeviceSelectState } from './boundDevicePresence';

describe('getBoundDevicePresence', () => {
  it('says checking, not offline, while the stored copy lacks the bound device', () => {
    expect(getBoundDevicePresence('dev-1', undefined, false)).toBe('checking');
  });

  it('reports the device missing only once the server confirmed the list', () => {
    expect(getBoundDevicePresence('dev-1', undefined, true)).toBe('missing');
  });

  it('says checking for a stored row with unknown presence', () => {
    expect(getBoundDevicePresence('dev-1', { online: false, onlineUnknown: true }, false)).toBe(
      'checking',
    );
  });

  it('reads presence from a confirmed row', () => {
    expect(getBoundDevicePresence('dev-1', { online: true }, true)).toBe('online');
    expect(getBoundDevicePresence('dev-1', { online: false }, true)).toBe('offline');
  });

  it('reports nothing bound', () => {
    expect(getBoundDevicePresence(undefined, undefined, true)).toBe('none');
  });
});

describe('getDeviceSelectState', () => {
  const base = {
    error: undefined,
    hasUnknownPresence: true,
    isConfirmed: false,
    isLoading: false,
    isValidating: true,
  };

  it('loads while the list is the stored copy', () => {
    expect(getDeviceSelectState(base)).toBe('loading');
  });

  it('surfaces a failed request of the unconfirmed list instead of loading forever', () => {
    expect(getDeviceSelectState({ ...base, error: new Error('boom'), isValidating: false })).toBe(
      'error',
    );
  });

  it('shows a retry in flight as loading', () => {
    expect(getDeviceSelectState({ ...base, error: new Error('boom') })).toBe('loading');
  });

  it('is ready once the server confirmed the list', () => {
    expect(
      getDeviceSelectState({
        ...base,
        hasUnknownPresence: false,
        isConfirmed: true,
        isValidating: false,
      }),
    ).toBe('ready');
  });
});
