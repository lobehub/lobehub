export interface RouteAttemptInput {
  apiType: string;
  channelId?: string;
  durationMs: number;
  error?: unknown;
  model: string;
  providerId: string;
  remark?: string;
  routerId?: string;
  success: boolean;
}

export interface ChannelStats {
  errorRate: number;
  errors: number;
  recentMinuteErrors: number;
  total: number;
}

export class RouterMetricsService {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async recordAttempt(_result: RouteAttemptInput): Promise<void> {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getChannelStats(_routerId: string, _channelId: string): Promise<ChannelStats> {
    return { errorRate: 0, errors: 0, recentMinuteErrors: 0, total: 0 };
  }

  async getAllChannelIds(): Promise<Array<{ channelId: string; routerId: string }>> {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async tryAcquireAlertLock(_routerId: string, _channelId: string): Promise<boolean> {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getModelStats(_modelId: string): Promise<ChannelStats> {
    return { errorRate: 0, errors: 0, recentMinuteErrors: 0, total: 0 };
  }

  async getAllModelIds(): Promise<string[]> {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async tryAcquireModelAlertLock(_modelId: string): Promise<boolean> {
    return false;
  }
}

export const routerMetricsService = new RouterMetricsService();
