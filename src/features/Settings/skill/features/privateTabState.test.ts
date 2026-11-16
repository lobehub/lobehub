import { describe, expect, it } from 'vitest';

import { privateTabState } from './privateTabState';

describe('privateTabState', () => {
  it('is loading, not empty, before the connector list has loaded', () => {
    // Regression: a cold visit painted "no private connectors" before the
    // list request had even started.
    expect(privateTabState({ count: 0, isConnectorsInit: false })).toBe('loading');
  });

  it('shows the failure of a list that could not load', () => {
    expect(
      privateTabState({ count: 0, error: new Error('offline'), isConnectorsInit: false }),
    ).toBe('error');
  });

  it('is empty only for a loaded list without private rows', () => {
    expect(privateTabState({ count: 0, isConnectorsInit: true })).toBe('empty');
    // A later refresh failing does not unread a loaded list
    expect(privateTabState({ count: 0, error: new Error('x'), isConnectorsInit: true })).toBe(
      'empty',
    );
  });

  it('lists rows it already has', () => {
    expect(privateTabState({ count: 2, isConnectorsInit: false })).toBe('list');
    expect(privateTabState({ count: 2, isConnectorsInit: true })).toBe('list');
  });
});
