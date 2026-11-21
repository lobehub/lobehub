import type { DeviceListItem } from '@lobechat/types';
import { TRPCClientError } from '@trpc/client';
import { describe, expect, it } from 'vitest';

import {
  type AutoEnrollInput,
  autoEnrollStorageKey,
  decideAutoEnroll,
  isPermanentEnrollRefusal,
} from './decide';

const row = (deviceId: string) => ({ deviceId }) as DeviceListItem;

const ready: AutoEnrollInput = {
  confirmedDevices: [row('someone-else')],
  handled: false,
  isGatewayConnected: true,
  isViewer: false,
  personalDeviceId: 'personal',
  workspaceDeviceId: 'ws-device',
  workspaceId: 'ws-1',
};

const trpcError = (code: string) =>
  Object.assign(new TRPCClientError('refused'), { data: { code } });

describe('decideAutoEnroll', () => {
  it('enrolls this machine when the workspace pool does not have it yet', () => {
    expect(decideAutoEnroll(ready)).toBe('enroll');
  });

  it('only remembers a machine that is already in the pool', () => {
    expect(decideAutoEnroll({ ...ready, confirmedDevices: [row('ws-device')] })).toBe(
      'markHandled',
    );
  });

  // A handled machine whose row is gone was removed by the user.
  it('never enrolls a machine again once handled for this workspace', () => {
    expect(decideAutoEnroll({ ...ready, handled: true })).toBe('skip');
  });

  it('skips outside a workspace and for viewers', () => {
    expect(decideAutoEnroll({ ...ready, workspaceId: null })).toBe('skip');
    expect(decideAutoEnroll({ ...ready, isViewer: true })).toBe('skip');
  });

  it('waits for the gateway, both device ids and a server-confirmed list', () => {
    expect(decideAutoEnroll({ ...ready, isGatewayConnected: false })).toBe('wait');
    expect(decideAutoEnroll({ ...ready, personalDeviceId: undefined })).toBe('wait');
    expect(decideAutoEnroll({ ...ready, workspaceDeviceId: undefined })).toBe('wait');
    expect(decideAutoEnroll({ ...ready, confirmedDevices: undefined })).toBe('wait');
  });
});

describe('isPermanentEnrollRefusal', () => {
  it('treats a conflict (another member keeps it private, or a managed device) as final', () => {
    expect(isPermanentEnrollRefusal(trpcError('CONFLICT'))).toBe(true);
  });

  it('lets an offline device, a role still loading or a network error retry later', () => {
    expect(isPermanentEnrollRefusal(trpcError('PRECONDITION_FAILED'))).toBe(false);
    expect(isPermanentEnrollRefusal(trpcError('FORBIDDEN'))).toBe(false);
    expect(isPermanentEnrollRefusal(new Error('network'))).toBe(false);
  });
});

describe('autoEnrollStorageKey', () => {
  it('keeps a record per account-and-machine and per workspace', () => {
    expect(autoEnrollStorageKey('personal', 'ws-1')).not.toBe(
      autoEnrollStorageKey('personal', 'ws-2'),
    );
    expect(autoEnrollStorageKey('personal', 'ws-1')).not.toBe(
      autoEnrollStorageKey('other-account', 'ws-1'),
    );
  });
});
