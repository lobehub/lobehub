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
