import { describe, expect, it } from 'vitest';

import {
  assertBearerServiceToken,
  assertServiceTokenConfigured,
  isWeakControlPlaneServiceToken,
  timingSafeStringEqual,
} from './serviceToken';

describe('control-plane serviceToken', () => {
  it('rejects weak / placeholder tokens', () => {
    expect(isWeakControlPlaneServiceToken(undefined)).toBe(true);
    expect(isWeakControlPlaneServiceToken('')).toBe(true);
    expect(isWeakControlPlaneServiceToken('devtok')).toBe(true);
    expect(isWeakControlPlaneServiceToken('DEVTOK')).toBe(true);
    expect(isWeakControlPlaneServiceToken('short')).toBe(true);
    expect(isWeakControlPlaneServiceToken('a'.repeat(24))).toBe(false);
  });

  it('timingSafeStringEqual matches equal strings', () => {
    expect(timingSafeStringEqual('abc', 'abc')).toBe(true);
    expect(timingSafeStringEqual('abc', 'abd')).toBe(false);
    expect(timingSafeStringEqual('short', 'longer-value')).toBe(false);
  });

  it('assertServiceTokenConfigured throws on weak env', () => {
    expect(() => assertServiceTokenConfigured('devtok')).toThrow(/too weak|missing/);
    expect(assertServiceTokenConfigured('x'.repeat(32))).toHaveLength(32);
  });

  it('assertBearerServiceToken requires matching Bearer', () => {
    const strong = `cp_${'a'.repeat(40)}`;
    const prev = process.env.AICO_CONTROL_PLANE_SERVICE_TOKEN;
    process.env.AICO_CONTROL_PLANE_SERVICE_TOKEN = strong;
    try {
      expect(
        assertBearerServiceToken(
          new Request('http://localhost/internal', {
            headers: { authorization: `Bearer ${strong}` },
          }),
        ),
      ).toBe(true);
      expect(
        assertBearerServiceToken(
          new Request('http://localhost/internal', {
            headers: { authorization: 'Bearer wrong-token-value-xxxxxxxxxxxx' },
          }),
        ),
      ).toBe(false);
      expect(assertBearerServiceToken(new Request('http://localhost/internal'))).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.AICO_CONTROL_PLANE_SERVICE_TOKEN;
      else process.env.AICO_CONTROL_PLANE_SERVICE_TOKEN = prev;
    }
  });
});
