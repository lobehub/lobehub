'use client';

import type { ReactNode } from 'react';

import { DirectoryBrowser } from './DirectoryBrowser';
import { useDeviceDirectorySource } from './sources/useDeviceDirectorySource';

interface RemoteDirectoryBrowserProps {
  defaultPath?: string;
  deviceId: string;
  error?: string;
  footerExtra?: ReactNode;
  loading: boolean;
  onCancel: () => void;
  onManual: (path: string) => void;
  onSelect: (path: string) => void;
}

/** {@link DirectoryBrowser} over a connected device's folders. */
export const RemoteDirectoryBrowser = ({ deviceId, ...props }: RemoteDirectoryBrowserProps) => {
  const source = useDeviceDirectorySource(deviceId);

  return <DirectoryBrowser {...props} source={source} />;
};
