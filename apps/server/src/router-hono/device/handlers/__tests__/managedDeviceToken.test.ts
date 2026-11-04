// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as managedDeviceModule from '@/business/server/managedDevice';

import app from '../../index';

type ManagedDeviceModule = typeof managedDeviceModule;

const mocks = vi.hoisted(() => ({
  exchange: vi.fn(),
  isAvailable: vi.fn(),
}));

vi.mock('@/business/server/managedDevice', async (importOriginal) => {
  const actual = await importOriginal<ManagedDeviceModule>();
  return {
    ...actual,
    exchangeManagedDeviceToken: mocks.exchange,
    managedDeviceProvider: {
      ...actual.managedDeviceProvider,
      isAvailable: mocks.isAvailable,
    },
  };
});

const post = (body: unknown) =>
  app.request('/api/device/managed/token', {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

const credentials = { deviceId: 'managed-device-1', secret: 'bootstrap-secret' };

const makeAvailable = () => mocks.isAvailable.mockReturnValue(true);

beforeEach(async () => {
  vi.restoreAllMocks();
  // Start every test from the open-source defaults.
  const actual = await vi.importActual<ManagedDeviceModule>('@/business/server/managedDevice');
  mocks.isAvailable.mockReset().mockImplementation(actual.managedDeviceProvider.isAvailable);
  mocks.exchange.mockReset().mockImplementation(actual.exchangeManagedDeviceToken);
});

describe('POST /api/device/managed/token', () => {
  it('answers 404 with the open-source defaults', async () => {
    const response = await post(credentials);

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers 404 when the exchange reports the capability unavailable', async () => {
    makeAvailable();

    expect((await post(credentials)).status).toBe(404);
    expect(mocks.exchange).toHaveBeenCalledWith(credentials);
  });

  it('rejects a malformed body without calling the exchange', async () => {
    makeAvailable();

    expect((await post('not json')).status).toBe(400);
    expect((await post({ deviceId: '', secret: 'x' })).status).toBe(400);
    expect((await post({ deviceId: 'managed-device-1' })).status).toBe(400);
    expect((await post({ ...credentials, deviceId: 'x'.repeat(65) })).status).toBe(400);
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it('refuses an oversized body', async () => {
    makeAvailable();

    const response = await post({ ...credentials, padding: 'x'.repeat(32 * 1024) });

    expect(response.status).toBe(413);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it('returns the issued token', async () => {
    makeAvailable();
    mocks.exchange.mockResolvedValue({
      expiresAt: '2030-01-01T00:00:00.000Z',
      status: 'issued',
      token: 'signed-token',
    });

    const response = await post(credentials);

    expect(mocks.exchange).toHaveBeenCalledWith(credentials);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      expiresAt: '2030-01-01T00:00:00.000Z',
      token: 'signed-token',
    });
  });

  it('answers 401 when the credentials do not match', async () => {
    makeAvailable();
    mocks.exchange.mockResolvedValue({
      status: 'invalid-credentials',
    });

    expect((await post(credentials)).status).toBe(401);
  });

  it('answers 500 without details when the exchange fails', async () => {
    makeAvailable();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.exchange.mockRejectedValue(new Error('boom'));

    const response = await post(credentials);

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('boom');
  });
});
