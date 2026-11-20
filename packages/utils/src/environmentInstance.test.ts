import { describe, expect, it } from 'vitest';

import {
  derivedInstanceDirectory,
  isDefaultInstance,
  markDefaultInstances,
  pickDefaultInstance,
} from './environmentInstance';

const at = (iso: string) => new Date(iso);

describe('pickDefaultInstance', () => {
  it('picks the instance created first, whatever order the list is in', () => {
    const first = { createdAt: at('2026-01-01T00:00:00Z'), id: 'ffff' };
    const second = { createdAt: at('2026-01-02T00:00:00Z'), id: '0000' };

    expect(pickDefaultInstance([second, first])).toBe(first);
    expect(pickDefaultInstance([first, second])).toBe(first);
  });

  it('breaks a tie on creation time by id, so every caller agrees', () => {
    const createdAt = at('2026-01-01T00:00:00Z');
    const a = { createdAt, id: '1b4e28ba-2fa1-11d2-883f-0016d3cca427' };
    const b = { createdAt, id: '9b4e28ba-2fa1-11d2-883f-0016d3cca427' };

    expect(pickDefaultInstance([b, a])).toBe(a);
    expect(pickDefaultInstance([a, b])).toBe(a);
  });

  it('reads timestamps that arrived serialized as strings', () => {
    // Rows that crossed tRPC without a transformer, or came out of a cache.
    const older = { createdAt: '2026-01-01T00:00:00.000Z', id: 'z' };
    const newer = { createdAt: '2026-03-01T00:00:00.000Z', id: 'a' };

    expect(pickDefaultInstance([newer, older])).toBe(older);
  });

  it('has no default for an environment without instances', () => {
    expect(pickDefaultInstance([])).toBeUndefined();
  });
});

describe('isDefaultInstance', () => {
  const createdAt = at('2026-01-01T00:00:00Z');
  const siblings = [
    { createdAt: at('2026-02-01T00:00:00Z'), id: 'a' },
    { createdAt, id: 'c' },
    { createdAt, id: 'b' },
  ];

  it('answers yes only for the earliest instance', () => {
    expect(isDefaultInstance({ id: 'b' }, siblings)).toBe(true);
    expect(isDefaultInstance({ id: 'c' }, siblings)).toBe(false);
    expect(isDefaultInstance({ id: 'a' }, siblings)).toBe(false);
  });

  it('treats a sole instance as the default', () => {
    expect(isDefaultInstance({ id: 'only' }, [{ createdAt, id: 'only' }])).toBe(true);
  });
});

describe('derivedInstanceDirectory', () => {
  it('uses the bare slug first and numbers the later attempts', () => {
    expect(derivedInstanceDirectory('Python 数据分析', 1)).toBe('python-数据分析');
    expect(derivedInstanceDirectory('Python 数据分析', 2)).toBe('python-数据分析-2');
    expect(derivedInstanceDirectory('...', 3)).toBe('environment-3');
  });
});

describe('markDefaultInstances', () => {
  it('flags one default per environment and keeps the list order', () => {
    const early = at('2026-01-01T00:00:00Z');
    const late = at('2026-02-01T00:00:00Z');
    const marked = markDefaultInstances([
      { createdAt: late, environmentId: 'env-a', id: 'a-late' },
      { createdAt: early, environmentId: 'env-b', id: 'b-only' },
      { createdAt: early, environmentId: 'env-a', id: 'a-early' },
    ]);

    expect(marked.map((instance) => [instance.id, instance.isDefault])).toEqual([
      ['a-late', false],
      ['b-only', true],
      ['a-early', true],
    ]);
  });
});
