import { describe, expect, it } from 'vitest';

import { resolveDefaultAgentId } from './defaultAgent';

describe('resolveDefaultAgentId', () => {
  const restored = [{ id: 'agt_removed' }, { id: 'agt_live' }];
  const confirmed = [{ id: 'agt_live' }, { id: 'agt_other' }];

  it('selects nothing from a restored list the server has not confirmed', () => {
    expect(resolveDefaultAgentId(restored, false, undefined)).toBeUndefined();
  });

  it('selects the first confirmed agent', () => {
    expect(resolveDefaultAgentId(confirmed, true, undefined)).toBe('agt_live');
  });

  it('replaces a pick the confirmed list no longer has', () => {
    expect(resolveDefaultAgentId(confirmed, true, 'agt_removed')).toBe('agt_live');
  });

  it('keeps a pick the confirmed list still has', () => {
    expect(resolveDefaultAgentId(confirmed, true, 'agt_other')).toBe('agt_other');
  });

  it('has no default for a confirmed empty scope', () => {
    expect(resolveDefaultAgentId([], true, 'agt_removed')).toBeUndefined();
  });
});
