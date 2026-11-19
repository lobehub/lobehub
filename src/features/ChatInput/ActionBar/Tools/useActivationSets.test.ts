import { describe, expect, it } from 'vitest';

import { resolveImplicitMode } from './librarySkillPolicy';
import { resolveActivationSets } from './useActivationSets';

const resolve = (rawPlugins: Parameters<typeof resolveActivationSets>[0]['rawPlugins']) =>
  resolveActivationSets({
    connectedConnectorIds: ['gmail', 'slack', 'linear'],
    connectorIds: ['gmail', 'slack', 'linear'],
    librarySkillIds: ['excalidraw'],
    // What `getActivePluginIds` yields: the entries that carry a pin.
    pinnedIds: (rawPlugins ?? []).flatMap((entry) =>
      typeof entry === 'string' ? [entry] : entry.mode === 'pinned' ? [entry.identifier] : [],
    ),
    rawPlugins,
  });

describe('resolveActivationSets', () => {
  it('puts inherited connectors under Auto and keeps library skills off', () => {
    const { checkedSet, disabledIdSet } = resolve([]);

    expect([...disabledIdSet]).toEqual(['excalidraw']);
    expect(disabledIdSet.has('lobe-creds')).toBe(false);
    expect(checkedSet.size).toBe(0);
  });

  it('lists a connector that is on under Auto: neither Pinned nor Disabled', () => {
    const { checkedSet, disabledIdSet } = resolve([{ identifier: 'gmail', mode: 'auto' }]);

    expect(checkedSet.has('gmail')).toBe(false);
    expect(disabledIdSet.has('gmail')).toBe(false);
  });

  it('never lists a connector under Pinned, even one pinned before the two-state switch', () => {
    const { checkedSet, disabledIdSet } = resolve(['gmail', 'lobe-image-generation']);

    expect(checkedSet.has('gmail')).toBe(false);
    expect(disabledIdSet.has('gmail')).toBe(false);
    // Legacy pins on configurable builtins also mean on demand.
    expect(checkedSet.has('lobe-image-generation')).toBe(false);
    expect(disabledIdSet.has('lobe-image-generation')).toBe(false);
  });

  it('keeps an explicitly disabled connector under Disabled', () => {
    const { disabledIdSet } = resolve([{ identifier: 'slack', mode: 'disabled' }]);

    expect(disabledIdSet.has('slack')).toBe(true);
  });

  it('inherits Auto for a connector in agent mode', () => {
    const { optInIds } = resolve([]);

    expect(resolveImplicitMode('gmail', optInIds)).toBe('auto');
    expect(resolveImplicitMode('lobe-image-generation', optInIds)).toBe('auto');
  });
});
