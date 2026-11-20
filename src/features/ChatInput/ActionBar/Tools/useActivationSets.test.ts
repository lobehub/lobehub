import { describe, expect, it } from 'vitest';

import { resolveImplicitMode } from './librarySkillPolicy';
import { resolveActivationSets } from './useActivationSets';

const resolve = (
  rawPlugins: Parameters<typeof resolveActivationSets>[0]['rawPlugins'],
  discoverBuiltins = true,
) =>
  resolveActivationSets({
    connectedConnectorIds: ['gmail', 'slack', 'linear'],
    connectorIds: ['gmail', 'slack', 'linear'],
    discoverBuiltins,
    rawPlugins,
  });

describe('resolveActivationSets', () => {
  it('puts inherited connectors and configurable builtins under Auto in agent mode', () => {
    const { disabledIdSet } = resolve([]);

    expect([...disabledIdSet]).toEqual([]);
    expect(disabledIdSet.has('lobe-creds')).toBe(false);
  });

  it('lists a connector that is on under Auto', () => {
    const { disabledIdSet } = resolve([{ identifier: 'gmail', mode: 'auto' }]);

    expect(disabledIdSet.has('gmail')).toBe(false);
  });

  it('treats legacy pinned entries as Auto (not Disabled)', () => {
    const { disabledIdSet } = resolve(['gmail', 'lobe-image-generation']);

    expect(disabledIdSet.has('gmail')).toBe(false);
    expect(disabledIdSet.has('lobe-image-generation')).toBe(false);
  });

  it('keeps an explicitly disabled connector under Disabled', () => {
    const { disabledIdSet } = resolve([{ identifier: 'slack', mode: 'disabled' }]);

    expect(disabledIdSet.has('slack')).toBe(true);
  });

  it('treats connectors as opt-in when discoverBuiltins is false (custom / chat mode)', () => {
    const { disabledIdSet, optInIds } = resolve([{ identifier: 'gmail', mode: 'auto' }], false);

    expect(disabledIdSet.has('gmail')).toBe(false);
    expect(disabledIdSet.has('slack')).toBe(true);
    expect(resolveImplicitMode('slack', optInIds)).toBe('disabled');
  });

  it('inherits Auto for a connector in agent mode', () => {
    const { optInIds } = resolve([]);

    expect(resolveImplicitMode('gmail', optInIds)).toBe('auto');
    expect(resolveImplicitMode('lobe-image-generation', optInIds)).toBe('auto');
  });
});
