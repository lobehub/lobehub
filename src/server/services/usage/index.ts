import dayjs from 'dayjs';
import debug from 'debug';
import { desc, eq } from 'drizzle-orm';

import { messages } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';
import { genRangeWhere, genWhere } from '@/database/utils/genWhere';
import { type MessageMetadata } from '@/types/message';
import { type UsageLog, type UsageRecordItem } from '@/types/usage/usageRecord';
import { formatDate } from '@/utils/format';

const log = debug('lobe-usage:service');

export class UsageRecordService {
  private userId: string;
  private db: LobeChatDatabase;
  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  /**
   * @description Find usage records by month.
   * @param mo Month
   * @returns UsageRecordItem[]
   */
  findByMonth = async (mo?: string): Promise<UsageRecordItem[]> => {
    // Set startAt and endAt
    let startAt: string;
    let endAt: string;
    if (mo && dayjs(mo, 'YYYY-MM', true).isValid()) {
      // mo format: "YYYY-MM"
      startAt = dayjs(mo, 'YYYY-MM').startOf('month').format('YYYY-MM-DD');
      endAt = dayjs(mo, 'YYYY-MM').endOf('month').format('YYYY-MM-DD');
    } else {
      startAt = dayjs().startOf('month').format('YYYY-MM-DD');
      endAt = dayjs().endOf('month').format('YYYY-MM-DD');
    }

    // TODO: To extend to support other features
    // - Functionality:
    //  - More type of usage, e.g. image generation, file processing, summary, search engine.
    //  - More dimension for analysis, e.g. relational analysis.
    // - Performance: Computing asynchronously for performance.
    // For now, we only support chat messages for normal users for PoC.

    const spends = await this.db
      .select({
        createdAt: messages.createdAt,
        id: messages.id,
        metadata: messages.metadata,
        model: messages.model,
        provider: messages.provider,
        role: messages.role,
        updatedAt: messages.createdAt,
        userId: messages.userId,
      })
      .from(messages)
      .where(
        genWhere([
          eq(messages.userId, this.userId),
          eq(messages.role, 'assistant'),
          genRangeWhere([startAt, endAt], messages.createdAt, (date) => date.toDate()),
        ]),
      )
      .orderBy(desc(messages.createdAt));
    return spends.map((spend) => {
      const metadata = spend.metadata as MessageMetadata;
      return {
        createdAt: spend.createdAt,
        id: spend.id,
        metadata: spend.metadata,
        model: spend.model,
        provider: spend.provider,
        spend: metadata?.cost || 0, // Messages do not have a direct cost associated
        totalInputTokens: metadata?.totalInputTokens || 0,
        totalOutputTokens: metadata?.totalOutputTokens || 0,
        totalTokens: (metadata?.totalInputTokens || 0) + (metadata?.totalOutputTokens || 0),
        tps: metadata?.tps || 0,
        ttft: metadata?.ttft || 0,
        type: 'chat', // Default to 'chat' for messages
        updatedAt: spend.createdAt,
        userId: spend.userId,
      } as UsageRecordItem;
    });
  };

  findAndGroupByDay = async (mo?: string): Promise<UsageLog[]> => {
    // Set startAt and endAt
    let startAt: string;
    let endAt: string;
    let month: string;
    if (mo && dayjs(mo, 'YYYY-MM', true).isValid()) {
      // mo format: "YYYY-MM"
      startAt = dayjs(mo, 'YYYY-MM').startOf('month').format('YYYY-MM-DD');
      endAt = dayjs(mo, 'YYYY-MM').endOf('month').format('YYYY-MM-DD');
      month = mo;
    } else {
      startAt = dayjs().startOf('month').format('YYYY-MM-DD');
      endAt = dayjs().endOf('month').format('YYYY-MM-DD');
      month = dayjs().format('YYYY-MM');
    }
    const spends = await this.findByMonth(month);
    // Clustering by time
    const usages = new Map<string, { date: Date; logs: UsageRecordItem[] }>();
    spends.forEach((spend) => {
      if (!usages.has(formatDate(spend.createdAt))) {
        usages.set(formatDate(spend.createdAt), { date: spend.createdAt, logs: [spend] });
        return;
      }
      usages.get(formatDate(spend.createdAt))?.logs.push(spend);
    });
    // Calculate usage
    const usageLogs: UsageLog[] = [];
    usages.forEach((spends, date) => {
      const totalSpend = spends.logs.reduce((acc, spend) => acc + spend.spend, 0);
      const totalTokens = spends.logs.reduce((acc, spend) => (spend.totalTokens || 0) + acc, 0);
      const totalRequests = spends.logs?.length ?? 0;
      log(
        'date',
        date,
        'totalSpend',
        totalSpend,
        'totalTokens',
        totalTokens,
        'totalRequests',
        totalRequests,
      );
      usageLogs.push({
        date: spends.date.getTime(),
        day: date,
        records: spends.logs,
        totalRequests,
        totalSpend,
        totalTokens, // Store the formatted date as a string
      });
    });
    // Padding to ensure the date range is complete
    const startDate = dayjs(startAt);
    const endDate = dayjs(endAt);
    const paddedUsageLogs: UsageLog[] = [];
    // For every day in the range, check if it exists in usageLogs
    // If exists, use it; if not, create a new log with 0 values
    log(
      'Padding usage logs from',
      startDate.format('YYYY-MM-DD'),
      'to',
      endDate.format('YYYY-MM-DD'),
    );
    for (let date = startDate; date.isBefore(endDate); date = date.add(1, 'day')) {
      const log = usageLogs.find((log) => log.day === date.format('YYYY-MM-DD'));
      if (log) {
        paddedUsageLogs.push(log);
      } else {
        paddedUsageLogs.push({
          date: date.toDate().getTime(),
          day: date.format('YYYY-MM-DD'),
          records: [],
          totalRequests: 0,
          totalSpend: 0,
          totalTokens: 0,
        });
      }
    }
    return paddedUsageLogs;
  };
}
