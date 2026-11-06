// @vitest-environment node
import type { DeviceCliUpdateState, DeviceCliUpdateStateResult } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import {
  checkCliDevices,
  classifyCliCheck,
  isCliChannel,
  updateCliDevices,
} from './cliBatchUpdate';

const REQUEST_ID = '89d177cf-52e5-4d55-b71c-13deef4ea366';

const state = (patch: Partial<DeviceCliUpdateState> = {}): DeviceCliUpdateState => ({
  activeTasks: 0,
  currentVersion: '0.0.70',
  instanceId: 'instance-1',
  latestVersion: '0.0.75',
  supported: true,
  ...patch,
});

const ok = (patch?: Partial<DeviceCliUpdateState>): DeviceCliUpdateStateResult => ({
  state: state(patch),
  status: 'ok',
});

describe('isCliChannel', () => {
  it.each([
    ['cli', true],
    ['cli-dev', true],
    ['desktop', false],
    ['client', false],
    [null, false],
    [undefined, false],
  ])('%s → %s', (channel, expected) => {
    expect(isCliChannel(channel)).toBe(expected);
  });
});

describe('classifyCliCheck', () => {
  it('marks an idle, supported CLI behind the latest release as ready', () => {
    expect(classifyCliCheck('d', ok())).toMatchObject({ deviceId: 'd', outcome: 'ready' });
  });

  it.each([
    ['upToDate', { latestVersion: undefined }],
    ['busy', { activeTasks: 2 }],
    [
      'inProgress',
      {
        operation: {
          fromInstanceId: 'instance-1',
          id: REQUEST_ID,
          kind: 'update' as const,
          stage: 'updating' as const,
          targetVersion: '0.0.75',
        },
      },
    ],
  ])('reports %s', (outcome, patch) => {
    expect(classifyCliCheck('d', ok(patch)).outcome).toBe(outcome);
  });

  it('treats a failed earlier operation as finished, not in progress', () => {
    const operation = {
      error: 'npm exited with code 1',
      fromInstanceId: 'instance-1',
      id: REQUEST_ID,
      kind: 'update' as const,
      stage: 'failed' as const,
      targetVersion: '0.0.75',
    };
    expect(classifyCliCheck('d', ok({ operation })).outcome).toBe('ready');
  });

  it('keeps the reason a CLI cannot be updated remotely', () => {
    expect(
      classifyCliCheck('d', ok({ supported: false, unsupportedReason: 'Foreground connection' })),
    ).toMatchObject({ message: 'Foreground connection', outcome: 'unsupported' });
  });

  it('reports an up-to-date foreground CLI as up to date rather than unsupported', () => {
    expect(classifyCliCheck('d', ok({ latestVersion: undefined, supported: false })).outcome).toBe(
      'upToDate',
    );
  });

  it.each([
    ['unsupported', 'unsupported'],
    ['unavailable', 'failed'],
    ['rejected', 'failed'],
  ] as const)('maps a %s relay to %s', (status, outcome) => {
    expect(classifyCliCheck('d', { message: 'boom', status })).toEqual({
      deviceId: 'd',
      message: 'boom',
      outcome,
    });
  });
});

describe('checkCliDevices', () => {
  it('checks live devices only and never restarts', async () => {
    const relay = { check: vi.fn().mockResolvedValue(ok()), restart: vi.fn() };
    const entries = await checkCliDevices(
      [
        { deviceId: 'live', live: true },
        { deviceId: 'away', live: false },
      ],
      relay,
    );
    expect(entries.map((e) => [e.deviceId, e.outcome])).toEqual([
      ['live', 'ready'],
      ['away', 'offline'],
    ]);
    expect(relay.check).toHaveBeenCalledTimes(1);
    expect(relay.check).toHaveBeenCalledWith('live');
    expect(relay.restart).not.toHaveBeenCalled();
  });
});

describe('updateCliDevices', () => {
  const target = { deviceId: 'd', live: true, requestId: REQUEST_ID };

  it('restarts a ready device under the caller request id and follows its operation', async () => {
    const operation = {
      fromInstanceId: 'instance-1',
      id: REQUEST_ID,
      kind: 'update' as const,
      stage: 'updating' as const,
      targetVersion: '0.0.75',
    };
    const relay = {
      check: vi.fn().mockResolvedValue(ok()),
      restart: vi.fn().mockResolvedValue(ok({ operation })),
    };
    await expect(updateCliDevices([target], relay)).resolves.toEqual([
      expect.objectContaining({ deviceId: 'd', operation, outcome: 'requested' }),
    ]);
    expect(relay.restart).toHaveBeenCalledWith({ deviceId: 'd', requestId: REQUEST_ID });
  });

  it.each([
    ['busy', { activeTasks: 1 }],
    ['upToDate', { latestVersion: undefined }],
    ['unsupported', { supported: false }],
  ])('skips a device that became %s since the plan', async (outcome, patch) => {
    const relay = { check: vi.fn().mockResolvedValue(ok(patch)), restart: vi.fn() };
    const [entry] = await updateCliDevices([target], relay);
    expect(entry.outcome).toBe(outcome);
    expect(relay.restart).not.toHaveBeenCalled();
  });

  it('skips an offline device without contacting it', async () => {
    const relay = { check: vi.fn(), restart: vi.fn() };
    await expect(updateCliDevices([{ ...target, live: false }], relay)).resolves.toEqual([
      { deviceId: 'd', outcome: 'offline' },
    ]);
    expect(relay.check).not.toHaveBeenCalled();
  });

  it('keeps following a restart whose acknowledgement was lost', async () => {
    const relay = {
      check: vi.fn().mockResolvedValue(ok()),
      restart: vi.fn().mockResolvedValue({ message: 'timeout', status: 'unavailable' }),
    };
    const [entry] = await updateCliDevices([target], relay);
    expect(entry).toMatchObject({
      message: 'timeout',
      operation: {
        fromInstanceId: 'instance-1',
        id: REQUEST_ID,
        kind: 'update',
        stage: 'updating',
        targetVersion: '0.0.75',
      },
      outcome: 'requested',
    });
  });

  it("does not follow another member's operation the device was already running", async () => {
    const theirs = {
      fromInstanceId: 'instance-1',
      id: '0f8fad5b-d9cb-469f-a165-70867728950e',
      kind: 'restart' as const,
      stage: 'restarting' as const,
      targetVersion: '0.0.70',
    };
    const relay = {
      check: vi.fn().mockResolvedValue(ok()),
      restart: vi.fn().mockResolvedValue(ok({ operation: theirs })),
    };
    const [entry] = await updateCliDevices([target], relay);
    expect(entry.outcome).toBe('inProgress');
    expect(entry.operation).toBeUndefined();
  });

  it('reports a restart the device declined', async () => {
    const relay = {
      check: vi.fn().mockResolvedValue(ok()),
      restart: vi
        .fn()
        .mockResolvedValue({ message: 'This device has active tasks.', status: 'rejected' }),
    };
    const [entry] = await updateCliDevices([target], relay);
    expect(entry).toMatchObject({ message: 'This device has active tasks.', outcome: 'failed' });
    expect(entry.operation).toBeUndefined();
  });

  it('isolates one failing device from the rest of the batch', async () => {
    const relay = {
      check: vi
        .fn()
        .mockImplementation(async (deviceId: string) =>
          deviceId === 'bad' ? { message: 'offline', status: 'unavailable' } : ok(),
        ),
      restart: vi.fn().mockResolvedValue(ok()),
    };
    const entries = await updateCliDevices(
      [
        { ...target, deviceId: 'bad' },
        { ...target, deviceId: 'good', requestId: '0f8fad5b-d9cb-469f-a165-70867728950e' },
      ],
      relay,
    );
    expect(entries.map((e) => [e.deviceId, e.outcome])).toEqual([
      ['bad', 'failed'],
      ['good', 'requested'],
    ]);
  });
});
