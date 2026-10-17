// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getGatewayConfig } from '../gateway';

describe('DEVICE_GATEWAY_PUBLIC_URL', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([undefined, '', '   '])('treats %j as not configured', (value) => {
    vi.stubEnv('DEVICE_GATEWAY_PUBLIC_URL', value);

    expect(getGatewayConfig().DEVICE_GATEWAY_PUBLIC_URL).toBeUndefined();
  });

  it.each([
    ['https://device-gateway.example.com', 'https://device-gateway.example.com'],
    ['http://192.168.1.10:8788', 'http://192.168.1.10:8788'],
    ['https://example.com/device-gateway', 'https://example.com/device-gateway'],
    ['https://device-gateway.example.com/', 'https://device-gateway.example.com'],
  ])('accepts the http(s) base URL %j', (value, expected) => {
    vi.stubEnv('DEVICE_GATEWAY_PUBLIC_URL', value);

    expect(getGatewayConfig().DEVICE_GATEWAY_PUBLIC_URL).toBe(expected);
  });

  it.each([
    'not a url',
    'ftp://device-gateway.example.com',
    'https://user:synthetic-secret@device-gateway.example.com',
    'https://device-gateway.example.com/?token=synthetic-secret',
    'https://device-gateway.example.com/#synthetic-secret',
  ])('fails validation for the non-empty invalid value %j', (value) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('DEVICE_GATEWAY_PUBLIC_URL', value);

    expect(() => getGatewayConfig()).toThrow('Invalid environment variables');
    const report = JSON.stringify(consoleError.mock.calls);
    expect(report).toContain('DEVICE_GATEWAY_PUBLIC_URL');
    expect(report).not.toContain('synthetic-secret');
  });
});
