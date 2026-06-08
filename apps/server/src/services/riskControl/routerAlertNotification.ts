export interface ChannelStats {
  errorCount: number;
  successCount: number;
  totalCount: number;
}

export interface AlertThresholds {
  errorRateThreshold: number;
  minSampleSize: number;
}

export const shouldAlert = (_stats: ChannelStats, _thresholds: AlertThresholds): boolean => {
  return false;
};

export const sendRouterChannelAlertNotification = async (_params: {
  channelId: string;
  model: string;
  routerId: string;
  stats: ChannelStats;
}): Promise<void> => {
  // Stub implementation
};

export const sendRouterModelAlertNotification = async (_params: {
  model: string;
  stats: ChannelStats;
}): Promise<void> => {
  // Stub implementation
};
