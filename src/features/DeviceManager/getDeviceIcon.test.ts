import { SiAndroid, SiApple, SiIos, SiLinux } from '@icons-pack/react-simple-icons';
import { Microsoft } from '@lobehub/icons';
import { Icon } from '@lobehub/ui';
import { CpuIcon, MonitorIcon } from 'lucide-react';
import { isValidElement, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { getDeviceIcon, getDeviceKind, getPlatformLabel } from './getDeviceIcon';

const iconOf = (platform: string | null | undefined) => {
  const node = getDeviceIcon(platform);
  expect(isValidElement(node)).toBe(true);
  return node as ReactElement<{ icon?: unknown }>;
};

describe('getDeviceKind', () => {
  it('buckets mobile platforms separately from desktop', () => {
    expect(getDeviceKind('android')).toBe('android');
    expect(getDeviceKind('ios')).toBe('ios');
  });

  it('keeps macOS / Windows / Linux in the desktop bucket', () => {
    expect(getDeviceKind('darwin')).toBe('desktop');
    expect(getDeviceKind('win32')).toBe('desktop');
    expect(getDeviceKind('linux')).toBe('desktop');
  });

  it('has no bucket for runtimes or unknown platforms', () => {
    expect(getDeviceKind('termux')).toBe('unknown');
    expect(getDeviceKind('freebsd')).toBe('unknown');
    expect(getDeviceKind(null)).toBe('unknown');
  });
});

describe('getDeviceIcon', () => {
  it('renders the Android and iOS icons for mobile devices', () => {
    expect(iconOf('android').type).toBe(SiAndroid);
    expect(iconOf('ios').type).toBe(SiIos);
  });

  it('keeps the original desktop icons', () => {
    expect(iconOf('darwin').type).toBe(SiApple);
    expect(iconOf('win32').type).toBe(Microsoft);
    expect(iconOf('linux').type).toBe(SiLinux);
  });

  it('falls back to a generic placeholder, not the desktop monitor', () => {
    for (const platform of ['freebsd', 'termux', null, undefined]) {
      const node = iconOf(platform);
      expect(node.type).toBe(Icon);
      expect(node.props.icon).toBe(CpuIcon);
      expect(node.props.icon).not.toBe(MonitorIcon);
    }
  });
});

describe('getPlatformLabel', () => {
  it('names known platforms and appends the architecture', () => {
    expect(getPlatformLabel('darwin', 'arm64')).toBe('macOS · arm64');
    expect(getPlatformLabel('win32')).toBe('Windows');
    expect(getPlatformLabel('linux', 'x64')).toBe('Linux · x64');
    expect(getPlatformLabel('ios')).toBe('iOS');
  });

  it('builds the Android subtitle from build.prop metadata', () => {
    expect(
      getPlatformLabel('android', 'arm64', {
        androidSdk: '33',
        androidVersion: '13',
        deviceModel: 'M2105K81AC',
        runtime: 'termux',
      }),
    ).toBe('Android 13 · SDK 33 · M2105K81AC · arm64');
    expect(getPlatformLabel('android', null, null)).toBe('Android');
  });

  it('ignores Android metadata on other platforms', () => {
    expect(getPlatformLabel('linux', 'arm64', { androidVersion: '13' })).toBe('Linux · arm64');
  });

  it('keeps an unknown platform verbatim', () => {
    expect(getPlatformLabel('freebsd', 'x64')).toBe('freebsd · x64');
  });

  it('returns undefined when nothing is known', () => {
    expect(getPlatformLabel(null, null)).toBeUndefined();
  });
});
