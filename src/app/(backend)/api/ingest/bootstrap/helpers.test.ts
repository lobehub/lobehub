import { afterEach, describe, expect, it } from 'vitest';

import { bootstrapPayloadSchema, isBodyTooLarge, isOriginAllowed, parseUA } from './helpers';

const validPayload = {
  appVersion: '1.0.0',
  cold: true,
  isLogin: false,
  platform: 'web',
  spans: [{ durMs: 10, name: 'bundle', startMs: 1 }],
  totalMs: 20,
};

describe('bootstrap ingest helpers', () => {
  afterEach(() => {
    delete process.env.BOOTSTRAP_METRICS_ALLOWED_ORIGINS;
  });

  it('accepts a valid bootstrap payload', () => {
    expect(bootstrapPayloadSchema.safeParse(validPayload).success).toBe(true);
  });

  it('caps spans to 64 items', () => {
    const result = bootstrapPayloadSchema.safeParse({
      ...validPayload,
      spans: Array.from({ length: 65 }, (_, index) => ({
        durMs: index,
        name: `span-${index}`,
        startMs: index,
      })),
    });

    expect(result.success).toBe(false);
  });

  it('rejects oversized request bodies', () => {
    expect(isBodyTooLarge('x'.repeat(8 * 1024 + 1))).toBe(true);
  });

  it('allows same-origin, absent-origin, and configured extra origins only', () => {
    expect(isOriginAllowed('https://app.example.com', 'https://app.example.com')).toBe(true);
    expect(isOriginAllowed(null, 'https://app.example.com')).toBe(true);
    expect(isOriginAllowed('https://evil.example.com', 'https://app.example.com')).toBe(false);

    process.env.BOOTSTRAP_METRICS_ALLOWED_ORIGINS = 'https://metrics.example.com';
    expect(isOriginAllowed('https://metrics.example.com', 'https://app.example.com')).toBe(true);
  });

  it('parses browser and operating system from user-agent', () => {
    const result = parseUA(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    );

    expect(result.browser).toBe('Chrome');
    expect(result.os).toBe('Mac OS');
  });
});
