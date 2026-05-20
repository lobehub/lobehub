import { describe, expect, it } from 'vitest';

import { sanitizeToolCallArguments } from './sanitizeToolCallArguments';

describe('sanitizeToolCallArguments', () => {
  it('passes valid JSON through unchanged to preserve prompt-cache keys', () => {
    const input = '{"description":"Create data models","language":"python"}';
    expect(sanitizeToolCallArguments(input)).toBe(input);
  });

  it('preserves whitespace and key order of valid JSON', () => {
    const input = '{\n  "a": 1,\n  "b": 2\n}';
    expect(sanitizeToolCallArguments(input)).toBe(input);
  });

  it('returns "{}" for empty string', () => {
    expect(sanitizeToolCallArguments('')).toBe('{}');
  });

  it('returns "{}" for undefined', () => {
    expect(sanitizeToolCallArguments(undefined)).toBe('{}');
  });

  it('falls back to "{}" on LOBE-7761 shape "{, ..."', () => {
    // exact shape from the reported NVIDIA/Qwen trace
    const input = '{, "description": "Create data models", "language": "python"}';
    expect(sanitizeToolCallArguments(input)).toBe('{}');
  });

  it('falls back to "{}" for unrecoverable garbage', () => {
    expect(sanitizeToolCallArguments('not json at all')).toBe('{}');
    expect(sanitizeToolCallArguments('{{{')).toBe('{}');
  });

  it('recovers truncated JSON via partial-json and re-stringifies', () => {
    // truncated mid-stream (common when max_tokens is exhausted)
    const input = '{"description": "Create data models", "language": "py';
    const out = sanitizeToolCallArguments(input);
    const parsed = JSON.parse(out);
    expect(parsed.description).toBe('Create data models');
    // partial-json may or may not recover the truncated final key; either
    // way, the output must be valid JSON
  });

  it('is idempotent on "{}"', () => {
    expect(sanitizeToolCallArguments('{}')).toBe('{}');
    expect(sanitizeToolCallArguments(sanitizeToolCallArguments('{}'))).toBe('{}');
  });

  it('does not widen scalar JSON to "{}"', () => {
    // `null` / numbers / booleans are valid JSON — callers that want object
    // arguments should enforce that separately. We only guarantee parseability.
    expect(sanitizeToolCallArguments('null')).toBe('null');
    expect(sanitizeToolCallArguments('123')).toBe('123');
    expect(sanitizeToolCallArguments('true')).toBe('true');
  });
});
