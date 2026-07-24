import { parseToolNameMaxLength } from '@lobechat/const/plugin';
import { afterEach, describe, expect, it } from 'vitest';

import { getToolNameMaxLength, setToolNameMaxLength, ToolNameResolver } from '../ToolNameResolver';

const resolver = new ToolNameResolver();

// A name whose `identifier____apiName` comfortably exceeds 64 chars.
const longIdentifier = 'a-fairly-long-connector-identifier-value';
const longApiName = 'someActionNameThatIsAlsoQuiteLongForGoodMeasureAndThenSome';

afterEach(() => {
  // Reset to the default so a stray config can't leak into other cases.
  setToolNameMaxLength(undefined);
});

describe('configurable tool-name max length', () => {
  it('defaults to 64 and compresses long names (unchanged behavior)', () => {
    expect(getToolNameMaxLength()).toBe(64);
    const result = resolver.generate(longIdentifier, longApiName, 'mcp');
    expect(result.length).toBeLessThan(64);
    expect(result).toContain('MD5HASH_');
  });

  it('disables length compression when set to 0', () => {
    setToolNameMaxLength(0);
    const result = resolver.generate(longIdentifier, longApiName, 'mcp');
    // Full, readable name — no MD5 hash, even though it exceeds 64 chars.
    expect(result).toBe(`${longIdentifier}____${longApiName}____mcp`);
    expect(result).not.toContain('MD5HASH_');
    expect(result.length).toBeGreaterThan(64);
  });

  it('still normalizes provider-invalid characters when compression is disabled', () => {
    setToolNameMaxLength(0);
    // Length compression is off, but invalid characters must still be hashed so
    // the wire name stays provider-safe — that is independent of length.
    const result = resolver.generate('mcp-server', 'get.current/weather', 'mcp');
    expect(result).toMatch(/^mcp-server____MD5HASH_[\da-f]+____mcp$/);
    expect(result).toMatch(/^[\w-]+$/);
    expect(result).not.toContain('get.current/weather');
  });

  it('compresses at a custom lower threshold', () => {
    // A ~48-char name: under the default 64 (stays readable) but over 30.
    const identifier = 'plugin';
    const apiName = 'anActionNameOverThirtyCharsLong';

    // Default threshold: not compressed.
    expect(resolver.generate(identifier, apiName, 'mcp')).not.toContain('MD5HASH_');

    // Lower the threshold to 30: the same name now compresses.
    setToolNameMaxLength(30);
    expect(resolver.generate(identifier, apiName, 'mcp')).toContain('MD5HASH_');
    // Names comfortably under the threshold stay untouched.
    expect(resolver.generate('plugin', 'action', 'mcp')).toBe('plugin____action____mcp');
  });

  it('resets to the default for invalid/undefined input', () => {
    setToolNameMaxLength(20);
    expect(getToolNameMaxLength()).toBe(20);
    setToolNameMaxLength(undefined);
    expect(getToolNameMaxLength()).toBe(64);
    setToolNameMaxLength(Number.NaN);
    expect(getToolNameMaxLength()).toBe(64);
    setToolNameMaxLength(-5);
    expect(getToolNameMaxLength()).toBe(64);
  });

  // Hosts that read the var through their own env layer (and ship it to the
  // browser, where `process.env` isn't visible) must reuse this parse — the same
  // env value has to mean the same thing wherever a name is generated.
  it('parses raw env values leniently, never throwing on a typo', () => {
    expect(parseToolNameMaxLength('0')).toBe(0);
    expect(parseToolNameMaxLength('64')).toBe(64);
    // No upper bound: an absurd value just means "never compress".
    expect(parseToolNameMaxLength('2048')).toBe(2048);
    // parseInt semantics, deliberately not `Number()` (which would give 100).
    expect(parseToolNameMaxLength('1e2')).toBe(1);
    // Unparseable / out-of-range input reads as "not configured" — the caller
    // falls back to the default rather than failing.
    expect(parseToolNameMaxLength(' ')).toBeUndefined();
    expect(parseToolNameMaxLength('-5')).toBeUndefined();
    expect(parseToolNameMaxLength('abc')).toBeUndefined();
    expect(parseToolNameMaxLength('')).toBeUndefined();
    expect(parseToolNameMaxLength(undefined)).toBeUndefined();
  });

  it('still roundtrips through resolve when compression is disabled', () => {
    setToolNameMaxLength(0);
    const toolName = resolver.generate(longIdentifier, longApiName, 'mcp');
    const [resolved] = resolver.resolve(
      [{ function: { arguments: '{}', name: toolName }, id: 'call_1', type: 'function' }],
      {
        [longIdentifier]: {
          api: [{ description: '', name: longApiName, parameters: {} }],
          identifier: longIdentifier,
          meta: {},
          type: 'mcp' as any,
        },
      },
    );
    expect(resolved.identifier).toBe(longIdentifier);
    expect(resolved.apiName).toBe(longApiName);
    expect(resolved.type).toBe('mcp');
  });
});
