import { SiApple, SiLinux } from '@icons-pack/react-simple-icons';
import { Microsoft } from '@lobehub/icons';
import { Icon } from '@lobehub/ui';
import { MonitorIcon } from 'lucide-react';
import { type ReactNode } from 'react';

export const getDeviceIcon = (platform: string | null | undefined, size = 18): ReactNode => {
  switch (platform) {
    case 'darwin': {
      return <SiApple color="currentColor" size={size} />;
    }
    case 'linux': {
      return <SiLinux color="currentColor" size={size} />;
    }
    case 'win32': {
      return <Microsoft color="currentColor" size={size} />;
    }
    default: {
      return <Icon icon={MonitorIcon} size={size} />;
    }
  }
};

const PLATFORM_LABEL: Record<string, string> = {
  darwin: 'macOS',
  linux: 'Linux',
  win32: 'Windows',
};

/** "macOS · arm64"-style OS line for a device; undefined when neither part is known. */
export const getPlatformLabel = (
  platform: string | null | undefined,
  architecture?: string | null,
): string | undefined => {
  const os = platform ? (PLATFORM_LABEL[platform] ?? platform) : undefined;
  return [os, architecture].filter(Boolean).join(' · ') || undefined;
};
