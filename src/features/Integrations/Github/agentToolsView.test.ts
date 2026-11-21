import { describe, expect, it } from 'vitest';

import { resolveAgentToolsView } from './agentToolsView';

const ready = { available: true, hasProvider: true, hasServer: false, isInitialLoading: false };

describe('resolveAgentToolsView', () => {
  it('hides the section on a deployment without LobeHub connectors', () => {
    expect(resolveAgentToolsView({ ...ready, available: false })).toBe('hidden');
    expect(resolveAgentToolsView({ ...ready, hasProvider: false })).toBe('hidden');
  });

  it('shows loading before the first answer', () => {
    expect(resolveAgentToolsView({ ...ready, isInitialLoading: true })).toBe('loading');
  });

  it('offers a retry only when a failure leaves nothing to show', () => {
    expect(resolveAgentToolsView({ ...ready, error: new Error('down') })).toBe('error');
    expect(resolveAgentToolsView({ ...ready, error: new Error('down'), hasServer: true })).toBe(
      'ready',
    );
  });

  it('shows the connect row when no connection exists yet', () => {
    expect(resolveAgentToolsView(ready)).toBe('ready');
  });
});
