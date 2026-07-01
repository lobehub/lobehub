import type { NewClientBootstrapMetric, NewClientBootstrapSpan } from '../schemas/bootstrapMetrics';
import { clientBootstrapMetrics, clientBootstrapSpans } from '../schemas/bootstrapMetrics';
import type { LobeChatDatabase } from '../type';
import { createNanoId } from '../utils/idGenerator';

const genBootstrapId = createNanoId(16);

export interface CreateBootstrapMetricInput {
  anonId?: string;
  appVersion: string;
  browser?: string;
  cold: boolean;
  country?: string;
  details?: unknown;
  isLogin: boolean;
  os?: string;
  platform: string;
  spans: { durMs: number; name: string; startMs: number }[];
  totalMs: number;
  userId?: string;
}

export class BootstrapMetricsModel {
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  create = async (input: CreateBootstrapMetricInput): Promise<{ id: string }> => {
    const id = `bm_${genBootstrapId()}`;

    await this.db.transaction(async (trx) => {
      const parentRow: NewClientBootstrapMetric = {
        anonId: input.anonId ?? null,
        appVersion: input.appVersion,
        browser: input.browser ?? null,
        cold: input.cold,
        country: input.country ?? null,
        details: input.details ?? null,
        id,
        isLogin: input.isLogin,
        os: input.os ?? null,
        platform: input.platform,
        totalMs: Math.round(input.totalMs),
        userId: input.userId ?? null,
      };

      await trx.insert(clientBootstrapMetrics).values(parentRow);

      if (input.spans.length > 0) {
        const spanRows: NewClientBootstrapSpan[] = input.spans.map((span) => ({
          durMs: Math.round(span.durMs),
          id: `bs_${genBootstrapId()}`,
          metricId: id,
          name: span.name,
          startMs: Math.round(span.startMs),
        }));

        await trx.insert(clientBootstrapSpans).values(spanRows);
      }
    });

    return { id };
  };
}
