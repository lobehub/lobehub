import { describe, expect, it } from 'vitest';

import {
  extractSeedToolCallsFromText,
  flushSeedToolCallBuffer,
  isDoubaoSeedModel,
  parseSeedToolCallBlock,
} from './parseSeedToolCall';

const INJECT_CREDS_BLOCK =
  'seed:tool_call<function name="lobe-creds____injectCredsToSandbox"><parameter name="keys" string="false">["shuyou"]</parameter></function></seed:tool_call>';

describe('isDoubaoSeedModel', () => {
  it('should match doubao-seed model ids', () => {
    expect(isDoubaoSeedModel('doubao-seed-2.0-pro')).toBe(true);
    expect(isDoubaoSeedModel('doubao-seed-2-0-pro-260215')).toBe(true);
  });

  it('should not match unrelated models', () => {
    expect(isDoubaoSeedModel('doubao-pro-32k')).toBe(false);
    expect(isDoubaoSeedModel('deepseek-v4-pro-260425')).toBe(false);
  });
});

describe('parseSeedToolCallBlock', () => {
  it('should parse injectCredsToSandbox tool call', () => {
    const parsed = parseSeedToolCallBlock(INJECT_CREDS_BLOCK);

    expect(parsed).toEqual({
      arguments: { keys: ['shuyou'] },
      name: 'lobe-creds____injectCredsToSandbox',
    });
  });

  it('should keep string parameters when string="true"', () => {
    const block =
      'seed:tool_call<function name="demo____run"><parameter name="path" string="true">/tmp/a</parameter></function></seed:tool_call>';
    const parsed = parseSeedToolCallBlock(block);

    expect(parsed).toEqual({
      arguments: { path: '/tmp/a' },
      name: 'demo____run',
    });
  });

  it('should return null for incomplete blocks', () => {
    expect(parseSeedToolCallBlock('seed:tool_call<function name="demo____run">')).toBeNull();
  });
});

describe('extractSeedToolCallsFromText', () => {
  it('should convert a complete block into tool_calls chunk', () => {
    const { chunks, remainingBuffer } = extractSeedToolCallsFromText(
      `prefix ${INJECT_CREDS_BLOCK} suffix`,
    );

    expect(remainingBuffer).toBe('');
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ data: 'prefix ', type: 'text' });
    expect(chunks[1]?.type).toBe('tool_calls');
    expect(chunks[1]?.data[0].function).toEqual({
      arguments: JSON.stringify({ keys: ['shuyou'] }),
      name: 'lobe-creds____injectCredsToSandbox',
    });
    expect(chunks[2]).toEqual({ data: ' suffix', type: 'text' });
  });

  it('should buffer incomplete blocks across chunks', () => {
    const part1 =
      'seed:tool_call<function name="demo____run"><parameter name="keys" string="false">["a"]';
    const part2 = '</parameter></function></seed:tool_call>';

    const first = extractSeedToolCallsFromText(part1);
    expect(first.chunks).toHaveLength(0);
    expect(first.remainingBuffer).toBe(part1);

    const second = extractSeedToolCallsFromText(part2, first.remainingBuffer);
    expect(second.remainingBuffer).toBe('');
    expect(second.chunks).toHaveLength(1);
    expect(second.chunks[0]?.type).toBe('tool_calls');
    expect(second.chunks[0]?.data[0].function.name).toBe('demo____run');
  });
});

describe('flushSeedToolCallBuffer', () => {
  it('should flush a complete buffered block on stream end', () => {
    const flushed = flushSeedToolCallBuffer(INJECT_CREDS_BLOCK);

    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.type).toBe('tool_calls');
  });

  it('should emit leftover text when buffer is not a tool call', () => {
    expect(flushSeedToolCallBuffer('plain tail')).toEqual([{ data: 'plain tail', type: 'text' }]);
  });
});
