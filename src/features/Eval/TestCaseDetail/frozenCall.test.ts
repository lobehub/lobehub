import { describe, expect, it } from 'vitest';

import { frozenToolNames, frozenTurns, readFrozenCall } from './frozenCall';

describe('frozenToolNames', () => {
  it('reads OpenAI and flat tool shapes and drops unnamed ones', () => {
    expect(
      frozenToolNames([{ function: { name: 'search' }, type: 'function' }, { name: 'crawl' }, {}]),
    ).toEqual(['search', 'crawl']);
    expect(frozenToolNames(undefined)).toEqual([]);
  });
});

describe('frozenTurns', () => {
  it('flattens content parts and lists tool calls by name', () => {
    expect(
      frozenTurns([
        { content: 'sys', role: 'system' },
        { content: [{ text: 'hi', type: 'text' }, { type: 'image_url' }], role: 'user' },
        { content: null, role: 'assistant', tool_calls: [{ function: { name: 'search' } }] },
      ]),
    ).toEqual([
      { role: 'system', text: 'sys', toolCalls: [] },
      { role: 'user', text: 'hi', toolCalls: [] },
      { role: 'assistant', text: '', toolCalls: ['search'] },
    ]);
  });
});

describe('readFrozenCall', () => {
  it('returns undefined for cases without an inline call', () => {
    expect(readFrozenCall(null)).toBeUndefined();
    expect(readFrozenCall({ stepIndex: 1 })).toBeUndefined();
    expect(readFrozenCall({ frozenAt: 'x', messages: [], stepIndex: 1 })?.stepIndex).toBe(1);
  });
});
