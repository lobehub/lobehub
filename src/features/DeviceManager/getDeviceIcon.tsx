import { SiAndroid, SiApple, SiIos, SiLinux } from '@icons-pack/react-simple-icons';
import { Microsoft } from '@lobehub/icons';
import { Icon } from '@lobehub/ui';
import { CpuIcon } from 'lucide-react';
import { type ReactNode } from 'react';

/**
 * Outward icon buckets. Mobile platforms get their own bucket instead of reusing
 * the desktop one; runtimes (e.g. Termux, stored as `metadata.runtime`) never get
 * a bucket of their own — a Termux device is an Android device.
 */
export type DeviceKind = 'android' | 'desktop' | 'ios' | 'unknown';

const DESKTOP_PLATFORMS = new Set(['darwin', 'linux', 'win32']);

export const getDeviceKind = (platform: string | null | undefined): DeviceKind => {
  if (platform === 'android') return 'android';
  if (platform === 'ios') return 'ios';
  if (platform && DESKTOP_PLATFORMS.has(platform)) return 'desktop';
  return 'unknown';
};

const getDesktopIcon = (platform: string, size: number): ReactNode => {
  switch (platform) {
    case 'darwin': {
      return <SiApple color="currentColor" size={size} />;
    }
    case 'win32': {
      return <Microsoft color="currentColor" size={size} />;
    }
    default: {
      return <SiLinux color="currentColor" size={size} />;
    }
  }
};

export const getDeviceIcon = (platform: string | null | undefined, size = 18): ReactNode => {
  switch (getDeviceKind(platform)) {
    case 'android': {
      return <SiAndroid color="currentColor" size={size} />;
    }
    case 'ios': {
      return <SiIos color="currentColor" size={size} />;
    }
    case 'desktop': {
      return getDesktopIcon(platform!, size);
    }
    default: {
      // Generic placeholder — never the desktop monitor, so an unrecognised
      // (e.g. future mobile) platform isn't passed off as a desktop.
      return <Icon icon={CpuIcon} size={size} />;
    }
  }
};

const PLATFORM_LABEL: Record<string, string> = {
  android: 'Android',
  darwin: 'macOS',
  ios: 'iOS',
  linux: 'Linux',
  win32: 'Windows',
};

/** Client-reported device facts that refine the OS line (see `resolveDevicePlatform` in the CLI). */
type PlatformMetadata = Record<string, string> | null | undefined;

const getOsName = (platform: string, metadata: PlatformMetadata): string => {
  const name = PLATFORM_LABEL[platform] ?? platform;
  if (platform !== 'android' || !metadata) return name;

  // "Android 13 · SDK 33 · M2105K81AC", from build.prop on the device.
  return [
    metadata.androidVersion ? `${name} ${metadata.androidVersion}` : name,
    metadata.androidSdk && `SDK ${metadata.androidSdk}`,
    metadata.deviceModel,
  ]
    .filter(Boolean)
    .join(' · ');
};

/** "macOS · arm64"-style OS line for a device; undefined when neither part is known. */
export const getPlatformLabel = (
  platform: string | null | undefined,
  architecture?: string | null,
  metadata?: PlatformMetadata,
): string | undefined => {
  const os = platform ? getOsName(platform, metadata) : undefined;
  return [os, architecture].filter(Boolean).join(' · ') || undefined;
};
