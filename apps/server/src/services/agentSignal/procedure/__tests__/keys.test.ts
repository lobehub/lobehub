import { buildProcedureMarkerKey, createProcedureKey, getCoarseProcedureDomain } from '../keys';

describe('Agent Signal procedure keys', () => {
  /**
   * @example
   * createProcedureKey({ messageId: 'm1' }) === 'message:m1'
   */
  it('uses structured ids before fallback root source id', () => {
    expect(createProcedureKey({ messageId: 'm1', rootSourceId: 'source_1' })).toBe('message:m1');
    expect(createProcedureKey({ operationId: 'op1', rootSourceId: 'source_1' })).toBe(
      'operation:op1',
    );
    expect(createProcedureKey({ rootSourceId: 'source_1', toolCallId: 'tool1' })).toBe(
      'tool-call:tool1',
    );
    expect(createProcedureKey({ rootSourceId: 'source_1' })).toBe('root-source:source_1');
  });

  /**
   * @example
   * getCoarseProcedureDomain('memory:user-preference') === 'memory'
   */
  it('groups domain buckets by coarse domain', () => {
    expect(getCoarseProcedureDomain('memory:user-preference')).toBe('memory');
    expect(getCoarseProcedureDomain('skill:managed-skill')).toBe('skill');
    expect(getCoarseProcedureDomain('document:agent-document')).toBe('document');
  });

  /**
   * @example
   * buildProcedureMarkerKey(...) returns the Redis policy marker key string.
   */
  it('builds marker keys from scope domain intent and structured procedure key', () => {
    expect(
      buildProcedureMarkerKey({
        domainKey: 'memory:user-preference',
        intentClass: 'explicit_persistence',
        procedureKey: 'message:m1',
        scopeKey: 'topic:t1',
      }),
    ).toBe(
      'agent-signal:policy:procedure-marker:topic:t1:memory:user-preference:explicit_persistence:message:m1',
    );
  });
});
