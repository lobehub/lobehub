import { describe, expect, it, vi } from 'vitest';

import { ANDROID_BUILD_PROP_PATH, resolveDevicePlatform, TERMUX_PREFIX } from './platform';

// A rooted Android 13 / SDK 33 tablet (Xiaomi Pad 5 Pro) running a Termux-style env.
const XIAOMI_BUILD_PROP = `
# begin common build properties
ro.build.version.release=13
ro.build.version.sdk=33
ro.product.model=M2105K81AC
ro.product.brand=Xiaomi
`;

const readBuildProp = (content = XIAOMI_BUILD_PROP) =>
  vi.fn((path: string) => {
    if (path === ANDROID_BUILD_PROP_PATH) return content;
    throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
  });

const missingFile = () =>
  vi.fn((path: string): string => {
    throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
  });

describe('resolveDevicePlatform', () => {
  it('classifies a linux host with a readable build.prop as android with a subtitle', () => {
    expect(
      resolveDevicePlatform({ env: {}, hostPlatform: 'linux', readFile: readBuildProp() }),
    ).toEqual({
      metadata: { androidSdk: '33', androidVersion: '13', deviceModel: 'M2105K81AC' },
      platform: 'android',
    });
  });

  it('marks Termux as runtime metadata without changing the android platform', () => {
    const result = resolveDevicePlatform({
      env: { PREFIX: TERMUX_PREFIX, TERMUX_VERSION: '0.118.0' },
      hostPlatform: 'linux',
      readFile: readBuildProp(),
    });

    expect(result.platform).toBe('android');
    expect(result.metadata).toEqual({
      androidSdk: '33',
      androidVersion: '13',
      deviceModel: 'M2105K81AC',
      runtime: 'termux',
    });
  });

  it.each([
    ['$PREFIX', { PREFIX: TERMUX_PREFIX }],
    ['$TERMUX_VERSION', { TERMUX_VERSION: '0.118.0' }],
  ])('detects Termux from %s alone', (_, env) => {
    const result = resolveDevicePlatform({ env, hostPlatform: 'android', readFile: missingFile() });
    expect(result).toEqual({ metadata: { runtime: 'termux' }, platform: 'android' });
  });

  it('never lets Termux env change the platform bucket', () => {
    const result = resolveDevicePlatform({
      env: { TERMUX_VERSION: '0.118.0' },
      hostPlatform: 'linux',
      readFile: missingFile(),
    });
    expect(result.platform).toBe('linux');
    expect(result.metadata.runtime).toBe('termux');
  });

  it('prefers an explicitly reported platform and skips local probing', () => {
    const readFile = readBuildProp();

    expect(
      resolveDevicePlatform({ env: {}, hostPlatform: 'linux', readFile, reportedPlatform: 'ios' }),
    ).toEqual({ metadata: {}, platform: 'ios' });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('keeps the host android platform when build.prop is unreadable', () => {
    expect(
      resolveDevicePlatform({ env: {}, hostPlatform: 'android', readFile: missingFile() }),
    ).toEqual({ metadata: {}, platform: 'android' });
  });

  it('keeps a genuine Linux desktop as linux', () => {
    expect(
      resolveDevicePlatform({
        env: { PREFIX: '/usr' },
        hostPlatform: 'linux',
        readFile: missingFile(),
      }),
    ).toEqual({ metadata: {}, platform: 'linux' });
  });

  it.each(['darwin', 'win32'])('never probes build.prop on %s', (hostPlatform) => {
    const readFile = readBuildProp();
    expect(resolveDevicePlatform({ env: {}, hostPlatform, readFile })).toEqual({
      metadata: {},
      platform: hostPlatform,
    });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('tolerates a build.prop without the subtitle keys', () => {
    expect(
      resolveDevicePlatform({
        env: {},
        hostPlatform: 'linux',
        readFile: readBuildProp('ro.product.brand=Xiaomi\n'),
      }),
    ).toEqual({ metadata: {}, platform: 'android' });
  });
});
