import type { DeviceListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  executionTargetValue,
  groupExecutionTargetDevices,
  isSharedExecutionTarget,
  parseExecutionTargetValue,
} from './index';

const device = (overrides: Partial<DeviceListItem>): DeviceListItem =>
  ({
    channels: [],
    defaultCwd: null,
    deviceId: 'device',
    enroller: null,
    friendlyName: null,
    hostname: null,
    identitySource: null,
    lastSeen: '',
    online: false,
    platform: null,
    registered: true,
    scope: 'personal',
    visibility: null,
    workingDirs: [],
    ...overrides,
  }) as DeviceListItem;

describe('ExecutionTargetPicker helpers', () => {
  it('round-trips shared targets and device ids', () => {
    expect(parseExecutionTargetValue(executionTargetValue('sandbox'))).toEqual({
      target: 'sandbox',
    });
    expect(parseExecutionTargetValue(executionTargetValue('device', 'workspace-device'))).toEqual({
      deviceId: 'workspace-device',
      target: 'device',
    });
  });

  it('separates personal, private workspace, and public workspace devices', () => {
    const personal = device({ deviceId: 'personal' });
    const privateWorkspace = device({
      deviceId: 'private',
      scope: 'workspace',
      visibility: 'private',
    });
    const publicWorkspace = device({
      deviceId: 'public',
      scope: 'workspace',
      visibility: 'public',
    });

    expect(groupExecutionTargetDevices([personal, privateWorkspace, publicWorkspace])).toEqual({
      personal: [personal],
      privateWorkspace: [privateWorkspace],
      publicWorkspace: [publicWorkspace],
      workspace: [publicWorkspace],
    });
  });

  it('allows only server-resolvable targets as shared defaults', () => {
    expect(isSharedExecutionTarget('none')).toBe(true);
    expect(isSharedExecutionTarget('auto')).toBe(true);
    expect(isSharedExecutionTarget('sandbox')).toBe(true);
    expect(isSharedExecutionTarget('device')).toBe(true);
    expect(isSharedExecutionTarget('local')).toBe(false);
  });
});
