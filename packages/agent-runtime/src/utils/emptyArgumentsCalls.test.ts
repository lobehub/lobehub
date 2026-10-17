import type { ChatToolPayload } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { AgentState } from '../types';
import {
  EMPTY_ARGS_TOOL_CONTENT,
  EMPTY_ARGS_TOOL_REASON,
  partitionEmptyArgumentsCalls,
  toolExpectsNoArguments,
} from './emptyArgumentsCalls';

const makeState = (manifestMap: Record<string, unknown> = {}): AgentState =>
  ({ toolManifestMap: manifestMap }) as unknown as AgentState;

const call = (overrides: Record<string, unknown>): ChatToolPayload =>
  ({
    id: 'call-1',
    identifier: 'tool-a',
    type: 'builtin',
    ...overrides,
  }) as unknown as ChatToolPayload;

describe('toolExpectsNoArguments', () => {
  it('returns true when the tool-level schema has no required array', () => {
    const state = makeState({
      'tool-a': { identifier: 'tool-a', parameters: { properties: {}, type: 'object' } },
    });
    expect(toolExpectsNoArguments(call({ apiName: 'run' }), state)).toBe(true);
  });

  it('returns true when required is an empty array', () => {
    const state = makeState({
      'tool-a': {
        identifier: 'tool-a',
        parameters: { properties: {}, required: [], type: 'object' },
      },
    });
    expect(toolExpectsNoArguments(call({ apiName: 'run' }), state)).toBe(true);
  });

  it('returns false when the schema requires parameters', () => {
    const state = makeState({
      'tool-a': {
        identifier: 'tool-a',
        parameters: {
          properties: { target: { type: 'string' } },
          required: ['target'],
          type: 'object',
        },
      },
    });
    expect(toolExpectsNoArguments(call({ apiName: 'run' }), state)).toBe(false);
  });

  it('prefers the api-level schema over the tool-level schema', () => {
    const state = makeState({
      'tool-a': {
        api: [
          { name: 'run', parameters: { required: ['x'], type: 'object' } },
          { name: 'runAll', parameters: { properties: {}, type: 'object' } },
        ],
        identifier: 'tool-a',
        parameters: { required: ['x'], type: 'object' },
      },
    });
    expect(toolExpectsNoArguments(call({ apiName: 'run' }), state)).toBe(false);
    expect(toolExpectsNoArguments(call({ apiName: 'runAll' }), state)).toBe(true);
  });

  it('falls back to the step-activated manifest when the static map misses the tool', () => {
    const state = {
      activatedStepTools: [
        {
          id: 'tool-a',
          manifest: { identifier: 'tool-a', parameters: { properties: {}, type: 'object' } },
        },
      ],
      operationId: 'test-session',
      toolManifestMap: {},
    } as unknown as AgentState;
    expect(toolExpectsNoArguments(call({ apiName: 'run' }), state)).toBe(true);
  });

  it('returns false when the manifest is missing or has no parameters schema', () => {
    expect(toolExpectsNoArguments(call({ apiName: 'run' }), makeState({}))).toBe(false);
    const state = makeState({ 'tool-a': { identifier: 'tool-a' } });
    expect(toolExpectsNoArguments(call({ apiName: 'run' }), state)).toBe(false);
  });

  it('rejects oneOf combinator schemas that accept no empty object (Codex P2 on PR #21013)', () => {
    const state = makeState({
      'tool-a': {
        identifier: 'tool-a',
        parameters: {
          oneOf: [
            { required: ['path'], type: 'object' },
            { required: ['url'], type: 'object' },
          ],
          type: 'object',
        },
      },
    });
    expect(toolExpectsNoArguments(call({ apiName: 'run' }), state)).toBe(false);
  });

  it('rejects allOf/anyOf/not/if combinators and minProperties', () => {
    const variants = [
      { allOf: [{ required: ['x'] }] },
      { anyOf: [{ required: ['x'] }] },
      { not: { required: ['x'] } },
      { unevaluatedProperties: false, type: 'object' },
      { minProperties: 1, type: 'object' },
      { enum: [{}, { a: 1 }] },
      { dependentRequired: { a: ['b'] }, properties: { a: { type: 'string' } }, type: 'object' },
    ];
    for (const parameters of variants) {
      const state = makeState({ 'tool-a': { identifier: 'tool-a', parameters } });
      expect(toolExpectsNoArguments(call({ apiName: 'run' }), state)).toBe(false);
    }
  });

  it('rejects a non-object type and a non-array required', () => {
    const state = makeState({
      'tool-a': { identifier: 'tool-a', parameters: { type: 'string' } },
      'tool-b': { identifier: 'tool-b', parameters: { required: 'x', type: 'object' } },
    });
    expect(toolExpectsNoArguments(call({ apiName: 'run' }), state)).toBe(false);
    expect(toolExpectsNoArguments(call({ apiName: 'run', identifier: 'tool-b' }), state)).toBe(
      false,
    );
  });
});

describe('partitionEmptyArgumentsCalls', () => {
  const state = makeState({
    'tool-a': { identifier: 'tool-a', parameters: { properties: {}, type: 'object' } },
    'tool-b': {
      identifier: 'tool-b',
      parameters: { required: ['x'], type: 'object' },
    },
  });

  it('keeps non-empty arguments executable without touching them', () => {
    const ok = call({ apiName: 'run', arguments: '{"x":1}' });
    const result = partitionEmptyArgumentsCalls([ok], state);
    expect(result).toEqual({ emptyArgsCalls: [], executableCalls: [ok] });
  });

  it('normalizes a missing arguments field on a no-param tool to "{}"', () => {
    const omitted = call({ apiName: 'run' });
    const result = partitionEmptyArgumentsCalls([omitted], state);
    expect(result.emptyArgsCalls).toEqual([]);
    expect(result.executableCalls).toEqual([{ ...omitted, arguments: '{}' }]);
  });

  it('normalizes an empty-string arguments field on a no-param tool to "{}"', () => {
    const blank = call({ apiName: 'run', arguments: '   ' });
    const result = partitionEmptyArgumentsCalls([blank], state);
    expect(result.emptyArgsCalls).toEqual([]);
    expect(result.executableCalls).toEqual([{ ...blank, arguments: '{}' }]);
  });

  it('rejects an empty-arguments call to a tool with required parameters', () => {
    const blank = call({ apiName: 'run', arguments: '' });
    // Same lookup shape, but the manifest requires parameters.
    const required = call({ identifier: 'tool-b', apiName: 'run', arguments: '' });
    const result = partitionEmptyArgumentsCalls([blank, required], {
      ...state,
      toolManifestMap: {
        'tool-a': { identifier: 'tool-a', parameters: { properties: {}, type: 'object' } },
        'tool-b': {
          identifier: 'tool-b',
          parameters: { required: ['x'], type: 'object' },
        },
      },
    } as AgentState);
    expect(result.executableCalls).toEqual([{ ...blank, arguments: '{}' }]);
    expect(result.emptyArgsCalls).toEqual([required]);
  });

  it('rejects a missing-arguments call when no manifest exists', () => {
    const unknown = call({ apiName: 'run' });
    const result = partitionEmptyArgumentsCalls([unknown], makeState({}));
    expect(result.executableCalls).toEqual([]);
    expect(result.emptyArgsCalls).toEqual([unknown]);
  });
});

describe('rejection feedback constants', () => {
  it('keeps the actionable single-call escape hint in the blocked content', () => {
    expect(EMPTY_ARGS_TOOL_CONTENT).toContain('Call the tool again one call at a time');
    expect(EMPTY_ARGS_TOOL_REASON).toBe('tool_arguments_empty');
  });
});
