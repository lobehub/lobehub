import { describe, expect, it } from 'vitest';

import { fromIpcErrorEnvelope, isIpcErrorEnvelope, toIpcErrorEnvelope } from './ipcError';

describe('ipcError envelope', () => {
  it('round-trips an Error and preserves its cause + code', () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND example.com'), {
      code: 'ENOTFOUND',
    });
    const error = new TypeError('fetch failed', { cause });

    const envelope = toIpcErrorEnvelope(error);
    expect(isIpcErrorEnvelope(envelope)).toBe(true);

    const revived = fromIpcErrorEnvelope(envelope);
    expect(revived).toBeInstanceOf(Error);
    expect(revived.name).toBe('TypeError');
    expect(revived.message).toBe('fetch failed');

    const revivedCause = revived.cause as Error & { code?: unknown };
    expect(revivedCause).toBeInstanceOf(Error);
    expect(revivedCause.message).toBe('getaddrinfo ENOTFOUND example.com');
    expect(revivedCause.code).toBe('ENOTFOUND');
  });

  it('is clone-safe: the envelope survives structuredClone (the IPC boundary)', () => {
    const error = new Error('boom', { cause: new Error('root') });
    const envelope = toIpcErrorEnvelope(error);

    const cloned = structuredClone(envelope);
    const revived = fromIpcErrorEnvelope(cloned);

    expect(revived.message).toBe('boom');
    expect((revived.cause as Error).message).toBe('root');
  });

  it('handles non-Error thrown values', () => {
    const revived = fromIpcErrorEnvelope(toIpcErrorEnvelope('plain string failure'));
    expect(revived.message).toBe('plain string failure');
  });

  it('caps a deep / cyclic cause chain instead of recursing forever', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b; // cycle

    // Should not throw (stack overflow) — depth is bounded.
    expect(() => toIpcErrorEnvelope(b)).not.toThrow();
  });

  it('isIpcErrorEnvelope rejects plain values and look-alikes', () => {
    expect(isIpcErrorEnvelope(null)).toBe(false);
    expect(isIpcErrorEnvelope(undefined)).toBe(false);
    expect(isIpcErrorEnvelope('error')).toBe(false);
    expect(isIpcErrorEnvelope({ data: 'ok' })).toBe(false);
    expect(isIpcErrorEnvelope({ __lobeIpcError__: false })).toBe(false);
  });
});
