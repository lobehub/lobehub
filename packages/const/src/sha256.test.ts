import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { sha256Hex } from './sha256';

const nodeSha256 = (input: string) => createHash('sha256').update(input, 'utf8').digest('hex');

describe('sha256Hex', () => {
  it('matches the standard digest across padding boundaries and UTF-8 input', () => {
    const inputs = [
      '',
      'abc',
      'http https://mcp.example.com/mcp?token=secret',
      'stdio ["node","mcp.js"]',
      'a'.repeat(55),
      'a'.repeat(56),
      'a'.repeat(63),
      'a'.repeat(64),
      'a'.repeat(65),
      'b'.repeat(1000),
      '多语言 ✓ émoji 🚀',
    ];

    for (const input of inputs) expect(sha256Hex(input)).toBe(nodeSha256(input));
  });

  it('works without crypto.subtle, as in a page that is not a secure context', () => {
    const subtle = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle');
    Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: undefined });
    try {
      expect(sha256Hex('abc')).toBe(nodeSha256('abc'));
    } finally {
      if (subtle) Object.defineProperty(globalThis.crypto, 'subtle', subtle);
    }
  });
});
