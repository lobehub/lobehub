import { describe, expect, it, vi } from 'vitest';

import { getDeviceFingerprint } from '../deviceFingerprint';

describe('getDeviceFingerprint', () => {
  it('should return a non-empty hex string', async () => {
    const fp = await getDeviceFingerprint();
    expect(fp).toBeTruthy();
    expect(fp).toMatch(/^[\da-f]+$/);
  });

  it('should return deterministic result for same environment', async () => {
    const fp1 = await getDeviceFingerprint();
    const fp2 = await getDeviceFingerprint();
    expect(fp1).toBe(fp2);
  });

  it('should fallback to djb2 when crypto.subtle is unavailable', async () => {
    const originalSubtle = globalThis.crypto.subtle;
    Object.defineProperty(globalThis.crypto, 'subtle', {
      configurable: true,
      value: undefined,
    });

    const fp = await getDeviceFingerprint();
    expect(fp).toBeTruthy();
    expect(fp).toMatch(/^[\da-f]+$/);
    // djb2 produces 8-char hex
    expect(fp).toHaveLength(8);

    Object.defineProperty(globalThis.crypto, 'subtle', {
      configurable: true,
      value: originalSubtle,
    });
  });

  it('should produce SHA-256 length (64 hex chars) when crypto.subtle is available', async () => {
    // happy-dom should have crypto.subtle
    if (!globalThis.crypto?.subtle) return;

    const fp = await getDeviceFingerprint();
    expect(fp).toHaveLength(64);
  });

  it('should handle canvas getContext returning null', async () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    const fp = await getDeviceFingerprint();
    expect(fp).toBeTruthy();

    spy.mockRestore();
  });

  it('should return a valid hash when window is undefined (SSR)', async () => {
    const originalWindow = globalThis.window;
    // @ts-ignore
    delete globalThis.window;

    const fp = await getDeviceFingerprint();
    expect(fp).toBeTruthy();
    expect(fp).toMatch(/^[\da-f]+$/);

    globalThis.window = originalWindow;
  });
});
