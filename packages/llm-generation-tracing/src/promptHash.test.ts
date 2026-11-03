import { describe, expect, it } from 'vitest';

import { computeInputHash, computePromptHash } from './promptHash';

describe('computePromptHash', () => {
  it('returns a 6-char hex digest', () => {
    const hash = computePromptHash('you are a helpful agent', { type: 'object' });
    expect(hash).toHaveLength(6);
    expect(hash).toMatch(/^[0-9a-f]{6}$/);
  });

  it('is stable across calls with the same input', () => {
    const a = computePromptHash('prompt-A', { foo: 1 });
    const b = computePromptHash('prompt-A', { foo: 1 });
    expect(a).toBe(b);
  });

  it('changes when system prompt changes', () => {
    const a = computePromptHash('prompt-A', { foo: 1 });
    const b = computePromptHash('prompt-B', { foo: 1 });
    expect(a).not.toBe(b);
  });

  it('changes when schema changes', () => {
    const a = computePromptHash('prompt', { foo: 1 });
    const b = computePromptHash('prompt', { foo: 2 });
    expect(a).not.toBe(b);
  });

  it('treats missing schema and empty schema differently', () => {
    const undef = computePromptHash('prompt', undefined);
    const empty = computePromptHash('prompt', {});
    expect(undef).not.toBe(empty);
  });
});

describe('computeInputHash', () => {
  it('returns a full-length sha256 hex', () => {
    expect(computeInputHash('hello')).toHaveLength(64);
    expect(computeInputHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});
