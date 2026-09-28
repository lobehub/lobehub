import { afterEach, describe, expect, it, vi } from 'vitest';

import { backfillDeviceArchitecture } from '../deviceArchitectureBackfill';

const options = {
  architecture: 'arm64',
  deviceId: 'local-device',
  headers: { 'Oidc-Auth': 'test-token' },
  serverUrl: 'https://server.example.com',
};
const localDevice = {
  architecture: null,
  deviceId: options.deviceId,
  identitySource: 'machine-id',
  registered: true,
  scope: 'personal',
};

afterEach(() => vi.unstubAllGlobals());

describe('backfillDeviceArchitecture', () => {
  it('repairs a missing local architecture without overwriting metadata or settings', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ result: { data: { json: [localDevice] } } }))
      .mockResolvedValueOnce(Response.json({ result: { data: { json: {} } } }));
    vi.stubGlobal('fetch', fetchMock);

    await backfillDeviceArchitecture(options);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      `${options.serverUrl}/trpc/lambda/device.updateDeviceInfo`,
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      json: { architecture: 'arm64', deviceId: options.deviceId },
    });
  });

  it.each([
    { devices: [{ ...localDevice, architecture: 'x64' }] },
    { devices: [{ ...localDevice, deviceId: 'remote-device' }] },
    { devices: [{ ...localDevice, scope: 'workspace' }] },
    { devices: [{ ...localDevice, registered: false }] },
    { devices: [] },
  ])('does not register devices that do not need local backfill: %j', async ({ devices }) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ result: { data: { json: devices } } }));
    vi.stubGlobal('fetch', fetchMock);
    await backfillDeviceArchitecture(options);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not write after a failed read', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(backfillDeviceArchitecture(options)).rejects.toThrow('HTTP 503');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on the next read after a failed write', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ result: { data: { json: [localDevice] } } }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ result: { data: { json: [localDevice] } } }))
      .mockResolvedValueOnce(Response.json({ result: { data: { json: {} } } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(backfillDeviceArchitecture(options)).rejects.toThrow('HTTP 503');
    await expect(backfillDeviceArchitecture(options)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
