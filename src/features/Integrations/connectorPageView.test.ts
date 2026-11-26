import { describe, expect, it } from 'vitest';

import { resolveConnectorPageView } from './connectorPageView';

const ready = { available: true, hasProvider: true, hasServer: false, isInitialLoading: false };

describe('resolveConnectorPageView', () => {
  it('hides the account on a deployment without LobeHub connectors', () => {
    expect(resolveConnectorPageView({ ...ready, available: false })).toBe('hidden');
    expect(resolveConnectorPageView({ ...ready, hasProvider: false })).toBe('hidden');
  });

  it('shows loading before the first answer', () => {
    expect(resolveConnectorPageView({ ...ready, isInitialLoading: true })).toBe('loading');
  });

  it('offers a retry only when a failure leaves nothing to show', () => {
    expect(resolveConnectorPageView({ ...ready, error: new Error('down') })).toBe('error');
    expect(resolveConnectorPageView({ ...ready, error: new Error('down'), hasServer: true })).toBe(
      'ready',
    );
  });

  it('shows the connect row when no connection exists yet', () => {
    expect(resolveConnectorPageView(ready)).toBe('ready');
  });
});
