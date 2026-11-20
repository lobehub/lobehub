import { describe, expect, it } from 'vitest';

import { getDevicePoolStatus } from './devicePoolStatus';

const base = { error: undefined, isConfirmed: false, isValidating: true, rowCount: 0 };

describe('getDevicePoolStatus', () => {
  it('reads a stored copy with no rows for this pool as loading, not empty', () => {
    // e.g. a workspace agent whose stored copy only holds personal devices.
    expect(getDevicePoolStatus(base)).toBe('loading');
  });

  it('surfaces a failed refresh of an unconfirmed pool instead of an empty hint', () => {
    expect(getDevicePoolStatus({ ...base, error: new Error('boom'), isValidating: false })).toBe(
      'error',
    );
  });

  it('shows the retry in flight as loading', () => {
    expect(getDevicePoolStatus({ ...base, error: new Error('boom') })).toBe('loading');
  });

  it('reports empty once the server confirmed the pool has no device', () => {
    expect(getDevicePoolStatus({ ...base, isConfirmed: true, isValidating: false })).toBe('empty');
  });

  it('shows rows straight away, stored or confirmed', () => {
    expect(getDevicePoolStatus({ ...base, rowCount: 2 })).toBe('devices');
    expect(getDevicePoolStatus({ ...base, isConfirmed: true, rowCount: 2 })).toBe('devices');
  });
});
