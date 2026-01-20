import { isDev } from '@/const/env';
import { getDesktopEnv } from '@/env';

// Update channel (stable, beta, alpha, etc.)
export const UPDATE_CHANNEL = getDesktopEnv().UPDATE_CHANNEL || 'stable';

// Determine if stable channel
export const isStableChannel = UPDATE_CHANNEL === 'stable' || !UPDATE_CHANNEL;

// Custom update server URL (for stable channel)
// e.g., https://releases.lobehub.com/stable
export const UPDATE_SERVER_URL = getDesktopEnv().UPDATE_SERVER_URL;

// GitHub configuration (for beta/nightly channels, or as fallback)
export const githubConfig = {
  owner: 'lobehub',
  repo: 'lobe-chat',
};

export const updaterConfig = {
  // 应用Update configuration
  app: {
    // Whether to auto-check for updates
    autoCheckUpdate: true,
    // Whether to auto-download updates
    autoDownloadUpdate: true,
    // Update check interval (milliseconds)
    checkUpdateInterval: 60 * 60 * 1000, // 1 hour
  },
  // Whether to enable application updates
  enableAppUpdate: !isDev,
};
