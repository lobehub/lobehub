import type { AgentInterventionSanitizedRequest } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  actionCapability,
  asRecord,
  canonicalDtoJson,
  canonicalJson,
  hasBoundedFormRecord,
  hasExactKeys,
  hashAgentInterventionRequestRevision,
  hasOnlyKeys,
  hasValidAnswers,
  hasValidCustomDetail,
  hasValidCustomResult,
  isBoundedFormValue,
  isCanonicalDtoJsonSafe,
  isCanonicalJsonSafe,
  isCustomExecutionResult,
  isPlainRecord,
  isUniqueViolation,
  normalizeDtoJson,
  providerOptionIds,
  sameDtoJson,
  sameJson,
  terminalStatusForAction,
  uniqueSorted,
} from '../utils';

const request = (patch: Partial<AgentInterventionSanitizedRequest>) =>
  patch as AgentInterventionSanitizedRequest;

describe('canonicalJson', () => {
  it('serializes JSON primitives', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson('text')).toBe('"text"');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(-1.5)).toBe('-1.5');
  });

  it('sorts object keys and drops undefined only when asked', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalDtoJson({ a: 1, b: undefined })).toBe('{"a":1}');
    // Strict mode keeps `undefined` and therefore rejects it as not JSON-safe.
    expect(() => canonicalJson({ a: 1, b: undefined })).toThrow(TypeError);
  });

  it('rejects values that are not JSON-safe', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson(Infinity)).toThrow(TypeError);
    expect(() => canonicalJson(() => undefined)).toThrow(TypeError);
    expect(() => canonicalJson(1n)).toThrow(TypeError);
    expect(() => canonicalJson(new Map())).toThrow(TypeError);
  });

  it('rejects cyclic and non-standard arrays', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(TypeError);

    const withExtraProp: unknown[] & { extra?: number } = [1];
    withExtraProp.extra = 2;
    expect(() => canonicalJson(withExtraProp)).toThrow(TypeError);
  });

  it('serializes arrays element by element', () => {
    expect(canonicalJson([])).toBe('[]');
    expect(canonicalJson(['b', 1, null])).toBe('["b",1,null]');
  });

  it('rejects non-standard and sparse arrays', () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(() => canonicalJson([1, , 3])).toThrow(TypeError);

    const unknownPrototype = Object.create(Array.prototype) as unknown[];
    expect(() => canonicalJson(unknownPrototype)).toThrow(TypeError);

    const withSymbol: unknown[] = [1];
    (withSymbol as unknown as Record<symbol, number>)[Symbol('s')] = 2;
    expect(() => canonicalJson(withSymbol)).toThrow(TypeError);
  });

  it('rejects hidden or symbol-keyed properties', () => {
    const value = { a: 1 } as Record<string | symbol, unknown>;
    Object.defineProperty(value, 'hidden', { enumerable: false, value: 2 });
    expect(() => canonicalJson(value)).toThrow(TypeError);

    expect(() => canonicalJson({ [Symbol('s')]: 1 })).toThrow(TypeError);
  });
});

describe('canonical json helpers', () => {
  it('compares by canonical form', () => {
    expect(sameJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameDtoJson({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameDtoJson({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('normalizes to a sorted plain object', () => {
    expect(normalizeDtoJson({ b: 1, a: 2 })).toEqual({ a: 2, b: 1 });
  });

  it('reports safety without throwing', () => {
    expect(isCanonicalJsonSafe({ a: 1 })).toBe(true);
    expect(isCanonicalJsonSafe(new Map())).toBe(false);
    expect(isCanonicalDtoJsonSafe({ a: 1 })).toBe(true);
    expect(isCanonicalDtoJsonSafe(new Map())).toBe(false);
  });
});

describe('small helpers', () => {
  it('dedupes and sorts strings', () => {
    expect(uniqueSorted(['b', 'a', 'b'])).toEqual(['a', 'b']);
  });

  it('recognises plain records', () => {
    expect(isPlainRecord({})).toBe(true);
    expect(isPlainRecord([])).toBe(false);
    expect(isPlainRecord(null)).toBe(false);
    expect(isPlainRecord('x')).toBe(false);
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord([1])).toEqual({});
    expect(asRecord(null)).toEqual({});
  });

  it('detects a pg unique violation including the wrapped cause', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });

  it('accepts only the custom execution result shape', () => {
    expect(isCustomExecutionResult({ content: 'c', pluginState: {} })).toBe(true);
    expect(isCustomExecutionResult({ content: 'c', extra: 1, pluginState: {} })).toBe(false);
    expect(isCustomExecutionResult({ content: 1, pluginState: {} })).toBe(false);
    expect(isCustomExecutionResult({ content: 'c' })).toBe(false);
  });

  it('checks allowed and exact key sets', () => {
    expect(hasOnlyKeys({ a: 1 }, ['a', 'b'])).toBe(true);
    expect(hasOnlyKeys({ c: 1 }, ['a'])).toBe(false);
    expect(hasExactKeys({ b: 1, a: 2 }, ['a', 'b'])).toBe(true);
    expect(hasExactKeys({ a: 1 }, ['a', 'b'])).toBe(false);
  });

  it('maps resolution actions to capabilities and terminal statuses', () => {
    expect(actionCapability({ type: 'stop' })).toBe('stop');
    expect(terminalStatusForAction({ type: 'stop' })).toBe('cancelled');
    expect(terminalStatusForAction({ type: 'cancel_interaction' })).toBe('cancelled');
    expect(terminalStatusForAction({ type: 'approve' })).toBe('resolved');
  });

  it('hashes the request revision deterministically', () => {
    expect(hashAgentInterventionRequestRevision('{"a":1}')).toBe(
      hashAgentInterventionRequestRevision('{"a":1}'),
    );
    expect(hashAgentInterventionRequestRevision('{"a":1}')).not.toBe(
      hashAgentInterventionRequestRevision('{"a":2}'),
    );
  });
});

describe('providerOptionIds', () => {
  it('collects option ids from options, questions and fields', () => {
    const ids = providerOptionIds(
      request({
        fields: [{ id: 'f', options: [{ id: 'field-opt' }] }],
        options: [{ id: 'top' }, {}],
        questions: [{ id: 'q', options: [{ id: 'question-opt' }, {}] }],
      } as never),
    );

    expect([...ids].sort()).toEqual(['field-opt', 'question-opt', 'top']);
  });

  it('returns an empty set when the request carries no options', () => {
    expect(providerOptionIds(request({}))).toEqual(new Set());
    expect(providerOptionIds(request({ fields: [{ id: 'no-options' }] } as never))).toEqual(
      new Set(),
    );
  });
});

describe('isBoundedFormValue', () => {
  it('accepts bounded scalars and string arrays', () => {
    expect(isBoundedFormValue(null)).toBe(true);
    expect(isBoundedFormValue(false)).toBe(true);
    expect(isBoundedFormValue(1.5)).toBe(true);
    expect(isBoundedFormValue('short')).toBe(true);
    expect(isBoundedFormValue(['a', 'b'])).toBe(true);
  });

  it('rejects unbounded or non-string values', () => {
    expect(isBoundedFormValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isBoundedFormValue('x'.repeat(10_001))).toBe(false);
    expect(isBoundedFormValue([1])).toBe(false);
    expect(isBoundedFormValue({})).toBe(false);
    expect(isBoundedFormValue(Array.from({ length: 101 }, () => 'a'))).toBe(false);
  });
});

describe('hasBoundedFormRecord', () => {
  it('accepts a shallow record of bounded values', () => {
    expect(hasBoundedFormRecord({ a: 'x', b: ['y'] })).toBe(true);
  });

  it('rejects non-records, empty keys and oversized values', () => {
    expect(hasBoundedFormRecord(null)).toBe(false);
    expect(hasBoundedFormRecord({ '': 'x' })).toBe(false);
    expect(hasBoundedFormRecord({ ['k'.repeat(257)]: 'x' })).toBe(false);
    expect(hasBoundedFormRecord({ a: {} })).toBe(false);
  });
});

describe('hasValidAnswers', () => {
  const questionRequest = request({
    questions: [
      {
        id: 'q1',
        multiSelect: true,
        options: [
          { id: 'o1', label: 'One' },
          { id: 'o2', label: 'Two' },
        ],
        question: 'Pick',
      },
      {
        multiSelect: false,
        options: [{ label: 'Label only' }],
        question: 'Pick one',
      },
    ],
  });

  it('accepts multi-select arrays limited to the declared options', () => {
    expect(hasValidAnswers(questionRequest, { 'Pick one': 'Label only', 'q1': ['o1', 'o2'] })).toBe(
      true,
    );
  });

  it('rejects a multi-select value that is not a string array', () => {
    expect(hasValidAnswers(questionRequest, { q1: 'o1' })).toBe(false);
    expect(hasValidAnswers(questionRequest, { q1: [1] })).toBe(false);
  });

  it('rejects answers outside the declared options or keys', () => {
    expect(hasValidAnswers(questionRequest, { q1: ['unknown'] })).toBe(false);
    expect(hasValidAnswers(questionRequest, { nope: 'x' })).toBe(false);
  });

  it('accepts a custom answer when the question allows it', () => {
    const allowCustom = request({
      questions: [
        {
          allowCustomAnswer: true,
          id: 'q1',
          multiSelect: false,
          options: [{ id: 'o1' }],
          question: 'Pick',
        },
      ],
    });

    expect(hasValidAnswers(allowCustom, { q1: 'typed' })).toBe(true);
  });

  it('requires a value for every question unless a freeform answer is given', () => {
    expect(hasValidAnswers(questionRequest, {})).toBe(false);
    expect(
      hasValidAnswers(
        request({ ...questionRequest, answerPolicy: { allowFreeform: true } } as never),
        { __freeform__: 'typed' },
      ),
    ).toBe(true);
    expect(
      hasValidAnswers(
        request({ ...questionRequest, answerPolicy: { allowFreeform: true } } as never),
        { __freeform__: 1 as never },
      ),
    ).toBe(false);
    expect(
      hasValidAnswers(
        request({ ...questionRequest, answerPolicy: { allowSupplement: true } } as never),
        { __supplement__: 'note' },
      ),
    ).toBe(false);
  });

  it('validates field definitions by type', () => {
    const fieldRequest = request({
      fields: [
        { id: 'flag', required: true, type: 'boolean' },
        { id: 'count', type: 'number' },
        {
          id: 'tags',
          options: [{ id: 't1' }],
          type: 'multi_select',
        },
        { id: 'text', options: [{ id: 'a' }, { id: 'b' }], type: 'string' },
      ],
    });

    expect(hasValidAnswers(fieldRequest, { count: 3, flag: true, tags: ['t1'], text: 'a' })).toBe(
      true,
    );
    expect(hasValidAnswers(fieldRequest, { count: '3', flag: true, tags: ['t1'], text: 'a' })).toBe(
      false,
    );
    expect(hasValidAnswers(fieldRequest, { count: 1, flag: true, tags: 't1', text: 'a' })).toBe(
      false,
    );
    expect(hasValidAnswers(fieldRequest, { count: 1, flag: true, tags: ['zzz'], text: 'a' })).toBe(
      false,
    );
    expect(hasValidAnswers(fieldRequest, { count: 1, flag: true, tags: ['t1'], text: 'zzz' })).toBe(
      false,
    );
    // `flag` is required and missing.
    expect(hasValidAnswers(fieldRequest, { count: 1, tags: ['t1'], text: 'a' })).toBe(false);
  });

  it('accepts a field without options and falls back to the option label', () => {
    const fieldRequest = request({
      fields: [
        { id: 'plain', type: 'string' },
        { id: 'choice', options: [{ label: 'Labelled' }], type: 'string' },
      ],
    });

    expect(hasValidAnswers(fieldRequest, { choice: 'Labelled', plain: 'x' })).toBe(true);
  });

  it('rejects a request that declares no answer surface', () => {
    expect(hasValidAnswers(request({}), { a: 'x' })).toBe(false);
  });
});

describe('hasValidCustomDetail', () => {
  const agentDetail = {
    agents: [{ id: 'a1', title: 'Agent' }],
    kind: 'agent_marketplace' as const,
  };

  it('treats a missing detail as valid', () => {
    expect(hasValidCustomDetail(request({}))).toBe(true);
  });

  it('rejects a detail that is not a plain record', () => {
    expect(hasValidCustomDetail(request({ customDetail: [] } as never))).toBe(false);
  });

  it('accepts a well-formed agent marketplace detail', () => {
    expect(
      hasValidCustomDetail(
        request({
          customDetail: {
            ...agentDetail,
            agents: [
              {
                avatar: 'https://example.com/a.png',
                description: 'desc',
                id: 'a1',
                title: 'Agent',
              },
            ],
            categoryHints: ['writing'],
            requestId: 'req-1',
            selectedIds: ['a1'],
          },
        } as never),
      ),
    ).toBe(true);
  });

  it('rejects unknown keys and a wrong kind', () => {
    expect(
      hasValidCustomDetail(request({ customDetail: { ...agentDetail, extra: 1 } } as never)),
    ).toBe(false);
    expect(
      hasValidCustomDetail(request({ customDetail: { ...agentDetail, kind: 'other' } } as never)),
    ).toBe(false);
  });

  it('rejects malformed agent entries', () => {
    expect(
      hasValidCustomDetail(request({ customDetail: { ...agentDetail, agents: 'a1' } } as never)),
    ).toBe(false);
    expect(
      hasValidCustomDetail(
        request({
          customDetail: {
            ...agentDetail,
            agents: Array.from({ length: 101 }, () => ({ id: 'a' })),
          },
        } as never),
      ),
    ).toBe(false);
    expect(
      hasValidCustomDetail(
        request({
          customDetail: { ...agentDetail, agents: [{ id: 'a1' }, { id: 'a1' }] },
        } as never),
      ),
    ).toBe(false);
    expect(
      hasValidCustomDetail(
        request({ customDetail: { ...agentDetail, agents: [{ id: 'a1', title: '' }] } } as never),
      ),
    ).toBe(false);
    expect(
      hasValidCustomDetail(
        request({
          customDetail: { ...agentDetail, agents: [{ avatar: 1, id: 'a1', title: 'x' }] },
        } as never),
      ),
    ).toBe(false);
    expect(
      hasValidCustomDetail(
        request({
          customDetail: { ...agentDetail, agents: [{ id: 'a1', title: 'x', description: 1 }] },
        } as never),
      ),
    ).toBe(false);
    expect(
      hasValidCustomDetail(request({ customDetail: { ...agentDetail, agents: ['a1'] } } as never)),
    ).toBe(false);
  });

  it('rejects malformed selectedIds, categoryHints and requestId', () => {
    const withDetail = (patch: Record<string, unknown>) =>
      request({ customDetail: { ...agentDetail, ...patch } } as never);

    expect(hasValidCustomDetail(withDetail({ selectedIds: 'a1' }))).toBe(false);
    expect(hasValidCustomDetail(withDetail({ selectedIds: ['missing'] }))).toBe(false);
    expect(hasValidCustomDetail(withDetail({ selectedIds: ['a1', 'a1'] }))).toBe(false);
    expect(hasValidCustomDetail(withDetail({ categoryHints: [''] }))).toBe(false);
    expect(hasValidCustomDetail(withDetail({ categoryHints: [1] }))).toBe(false);
    expect(hasValidCustomDetail(withDetail({ categoryHints: 'x' }))).toBe(false);
    expect(hasValidCustomDetail(withDetail({ requestId: '' }))).toBe(false);
    expect(hasValidCustomDetail(withDetail({ requestId: 1 }))).toBe(false);
  });
});

describe('hasValidCustomResult', () => {
  it('rejects a non-record result', () => {
    expect(hasValidCustomResult(request({}), null)).toBe(false);
  });

  it('accepts any bounded record when no detail is declared', () => {
    expect(hasValidCustomResult(request({}), { any: 'thing' })).toBe(true);
  });

  it('requires selectedIds to come from the declared agents', () => {
    const withDetail = request({
      customDetail: { agents: [{ id: 'a1', title: 'A' }], kind: 'agent_marketplace' },
    } as never);

    expect(hasValidCustomResult(withDetail, { selectedIds: ['a1'] })).toBe(true);
    expect(hasValidCustomResult(withDetail, { selectedIds: ['a2'] })).toBe(false);
    expect(hasValidCustomResult(withDetail, { selectedIds: 'a1' })).toBe(false);
    expect(hasValidCustomResult(withDetail, { other: [] })).toBe(false);
    expect(hasValidCustomResult(withDetail, { selectedIds: ['a1', 'a1'] })).toBe(false);
  });

  it('rejects an unknown detail kind', () => {
    const withDetail = request({ customDetail: { agents: [], kind: 'other' } } as never);

    expect(hasValidCustomResult(withDetail, { selectedIds: [] })).toBe(false);
  });
});
