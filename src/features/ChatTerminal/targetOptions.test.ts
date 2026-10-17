import type { DeviceListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildTargetOptions, LOCAL_TARGET } from './targetOptions';

const device = (patch: Partial<DeviceListItem>) =>
  ({ deviceId: 'dev_1', ...patch }) as DeviceListItem;

describe('buildTargetOptions', () => {
  it('gives the local option a non-empty value so Select can render its label', () => {
    const [local] = buildTargetOptions([], 'This computer');

    expect(local).toEqual({ label: 'This computer', value: LOCAL_TARGET });
    expect(local.value).not.toBe('');
  });

  it('omits the local option without a label', () => {
    expect(buildTargetOptions([device({})])).toEqual([{ label: 'dev_1', value: 'dev_1' }]);
  });

  it('labels devices by friendly name, then hostname, then id', () => {
    const options = buildTargetOptions([
      device({ deviceId: 'a', friendlyName: 'Laptop', hostname: 'host-a' }),
      device({ deviceId: 'b', hostname: 'host-b' }),
      device({ deviceId: 'c' }),
    ]);

    expect(options.map((option) => option.label)).toEqual(['Laptop', 'host-b', 'c']);
  });
});
