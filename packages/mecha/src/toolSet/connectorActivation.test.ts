import { describe, expect, it } from 'vitest';

import { applyConnectorActivation, resolveConnectorActivation } from './connectorActivation';

describe('resolveConnectorActivation', () => {
  it('leaves a connector the agent never turned on out of reach', () => {
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
