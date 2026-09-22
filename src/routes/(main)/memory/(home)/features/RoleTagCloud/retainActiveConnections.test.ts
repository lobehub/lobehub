import { describe, expect, it } from 'vitest';

import { retainActiveConnections } from './retainActiveConnections';

describe('retainActiveConnections', () => {
  it('keeps idle ticks referentially stable, including an empty cloud', () => {
    const connections = [{ birthTime: 1, duration: 2 }];
    expect(retainActiveConnections(connections, 2)).toBe(connections);
    const empty: typeof connections = [];
    expect(retainActiveConnections(empty, 10)).toBe(empty);
  });

  it('expires connections at their deadline without replacing survivors or mutating state', () => {
    const expired = { birthTime: 1, duration: 2 };
    const survivor = { birthTime: 2, duration: 4 };
    const connections = [expired, survivor];
    const active = retainActiveConnections(connections, 3);
    expect(active).toEqual([survivor]);
    expect(active[0]).toBe(survivor);
    expect(connections).toEqual([expired, survivor]);
    expect(retainActiveConnections(active, 6)).toEqual([]);
  });
});
