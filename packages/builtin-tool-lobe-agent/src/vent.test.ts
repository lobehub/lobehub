import { describe, expect, it } from 'vitest';

import {
  createMemoryVentLedger,
  getVentFingerprint,
  getVentScope,
  validateVentParams,
  VENT_LIMIT_PER_OPERATION,
  VENT_LIMIT_PER_TOPIC,
} from './vent';

describe('getVentScope', () => {
  it('prefers the run over the topic', () => {
    expect(getVentScope({ operationId: 'op-1', topicId: 'tpc-1' })).toEqual({
      key: 'operation:op-1',
      limit: VENT_LIMIT_PER_OPERATION,
    });
    expect(getVentScope({ topicId: 'tpc-1' })).toEqual({
      key: 'topic:tpc-1',
      limit: VENT_LIMIT_PER_TOPIC,
    });
    expect(getVentScope({})).toBeUndefined();
  });
});

describe('getVentFingerprint', () => {
  it('ignores case and whitespace differences', () => {
    expect(getVentFingerprint({ details: ' a  b ', summary: 'Stop' })).toBe(
      getVentFingerprint({ details: 'A b', summary: 'stop ' }),
    );
    expect(getVentFingerprint({ details: 'a', summary: 'Stop' })).not.toBe(
      getVentFingerprint({ details: 'a', summary: 'Stop loop' }),
    );
  });
});

describe('validateVentParams', () => {
  it('rejects empty content after enum checks', () => {
    const base = { category: 'other', details: '', severity: 'low', summary: '  ' } as const;

    expect(validateVentParams(base)).toBe('empty_content');
    expect(validateVentParams({ ...base, category: 'x' as never })).toBe('invalid_category');
    expect(validateVentParams({ ...base, severity: 'x' as never })).toBe('invalid_severity');
    expect(validateVentParams({ ...base, details: 'tool 500s' })).toBeUndefined();
  });
});

describe('createMemoryVentLedger', () => {
  it('admits up to the limit and reports repeats as duplicates', () => {
    const ledger = createMemoryVentLedger();
    const admit = (fingerprint: string) => ledger.admit({ fingerprint, limit: 2, scopeKey: 's' });

    expect(admit('a')).toBe('accepted');
    expect(admit('a')).toBe('duplicate');
    expect(admit('b')).toBe('accepted');
    expect(admit('c')).toBe('rate_limited');
    expect(ledger.admit({ fingerprint: 'c', limit: 2, scopeKey: 'other' })).toBe('accepted');
  });

  it('evicts the least recently used scope past its capacity', () => {
    const ledger = createMemoryVentLedger({ maxScopes: 2 });
    const admit = (scopeKey: string) => ledger.admit({ fingerprint: 'a', limit: 1, scopeKey });

    admit('s1');
    admit('s2');
    admit('s3');

    expect(admit('s1')).toBe('accepted');
    expect(admit('s3')).toBe('duplicate');
  });
});
