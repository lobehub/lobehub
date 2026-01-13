import { isDev } from '@/const/env';
import { getDesktopEnv } from '@/env';

// 更新频道（stable, beta, alpha 等）
export const UPDATE_CHANNEL = getDesktopEnv().UPDATE_CHANNEL;

export const updaterConfig = {
  // 应用更新配置
  app: {
    // 是否自动检查更新
    autoCheckUpdate: true,
    // 是否自动下载更新
    autoDownloadUpdate: true,
    // 检查更新的时间间隔（毫秒）
    checkUpdateInterval: 60 * 60 * 1000, // 1小时
  },

  // 是否启用应用更新
  enableAppUpdate: !isDev,

  // 是否启用渲染层热更新
  enableRenderHotUpdate: !isDev,
};
