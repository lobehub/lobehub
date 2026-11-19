import { describe, expect, it } from 'vitest';

import {
  applyConnectorActivation,
  hasConnectorActivator,
  resolveConnectorActivation,
} from './connectorActivation';

describe('hasConnectorActivator', () => {
  it('has the activator in agent mode, the default', () => {
    expect(hasConnectorActivator(undefined)).toBe(true);
    expect(hasConnectorActivator({})).toBe(true);
    expect(hasConnectorActivator({ skillActivateMode: 'auto' })).toBe(true);
  });

  it('ignores the retired tool discovery switch', () => {
    expect(hasConnectorActivator({ skillActivateMode: 'manual' })).toBe(true);
  });

  it('has none in custom mode, which exposes exactly the declared plugins', () => {
    expect(hasConnectorActivator({ toolMode: 'custom' })).toBe(false);
  });

  it('has none in chat mode', () => {
    expect(hasConnectorActivator({ enableAgentMode: false })).toBe(false);
    expect(hasConnectorActivator({ toolMode: 'chat' })).toBe(false);
  });
});

describe('resolveConnectorActivation', () => {
  it('offers inherited connections on demand and respects an explicit opt-out', () => {
    const activation = resolveConnectorActivation({
      disabledIds: ['slack'],
      discoverByDefault: true,
      hasActivator: true,
      optedInIds: [],
    });
    expect(activation.isAllowed('notion')).toBe(true);
    expect(activation.isInjected('notion')).toBe(false);
    expect(activation.isAllowed('slack')).toBe(false);
  });

  it('requires an explicit entry for a custom toolset', () => {
    const activation = resolveConnectorActivation({ hasActivator: true, optedInIds: ['gmail'] });

    expect(activation.isAllowed('gmail')).toBe(true);
    expect(activation.isAllowed('slack')).toBe(false);
  });

  it('keeps a connector that is on discoverable rather than injected', () => {
    const activation = resolveConnectorActivation({ hasActivator: true, optedInIds: ['gmail'] });

    expect(activation.isInjected('gmail')).toBe(false);
  });

  it('injects a connector that is on when the run has no activator', () => {
    const activation = resolveConnectorActivation({ hasActivator: false, optedInIds: ['gmail'] });

    expect(activation.isInjected('gmail')).toBe(true);
    expect(activation.isInjected('slack')).toBe(false);
  });

  it('reaches and injects a connector the turn brings in, even when it is off', () => {
    const activation = resolveConnectorActivation({
      hasActivator: true,
      optedInIds: [],
      turnIds: ['slack'],
    });

    expect(activation.isAllowed('slack')).toBe(true);
    expect(activation.isInjected('slack')).toBe(true);
  });
});

describe('applyConnectorActivation', () => {
  it('drops a pinned connector from the invocation set and keeps other tools', () => {
    const activation = resolveConnectorActivation({
      hasActivator: true,
      optedInIds: ['gmail', 'lobe-image-generation'],
    });

    expect(
      applyConnectorActivation(['lobe-image-generation', 'gmail'], ['gmail', 'slack'], activation),
    ).toEqual(['lobe-image-generation']);
  });

  it('adds a connector that is on to the invocation set without the activator', () => {
    const activation = resolveConnectorActivation({
      hasActivator: false,
      optedInIds: ['gmail', 'a-skill'],
    });

    expect(applyConnectorActivation(['a-pinned-skill'], ['gmail', 'slack'], activation)).toEqual([
      'a-pinned-skill',
      'gmail',
    ]);
  });

  it('keeps a connector the turn mentions', () => {
    const activation = resolveConnectorActivation({
      hasActivator: true,
      optedInIds: [],
      turnIds: ['slack'],
    });

    expect(applyConnectorActivation(['slack'], ['gmail', 'slack'], activation)).toEqual(['slack']);
  });
});
