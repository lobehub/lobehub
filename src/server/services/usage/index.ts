import dayjs from 'dayjs';
import debug from 'debug';
import { desc, eq, inArray } from 'drizzle-orm';

import { departmentQuotas, messages, users } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';
import { genRangeWhere, genWhere } from '@/database/utils/genWhere';
import { type MessageMetadata } from '@/types/message';
import { type UsageLog, type UsageRecordItem } from '@/types/usage/usageRecord';
import { formatDate } from '@/utils/format';

const log = debug('lobe-usage:service');

export interface QuotaCheckResult {
  effectiveDailyCostLimit: number | null;
  effectiveDailyTokenLimit: number | null;
  effectiveMonthlyCostLimit: number | null;
  effectiveMonthlyTokenLimit: number | null;
  monthlyCost: number;
  monthlyTokens: number;
  status: 'ok' | 'warning' | 'exceeded';
  todayCost: number;
  todayTokens: number;
}

export class UsageRecordService {
  private userId: string;
  private db: LobeChatDatabase;
  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  /**
   * @description Find usage records by date range.
   */
  findByDateRange = async (startAt: string, endAt: string): Promise<UsageRecordItem[]> => {
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
        spend: metadata?.cost || 0,
        totalInputTokens: metadata?.totalInputTokens || 0,
        totalOutputTokens: metadata?.totalOutputTokens || 0,
        totalTokens: (metadata?.totalInputTokens || 0) + (metadata?.totalOutputTokens || 0),
        tps: metadata?.tps || 0,
        ttft: metadata?.ttft || 0,
        type: 'chat',
        updatedAt: spend.createdAt,
        userId: spend.userId,
      } as UsageRecordItem;
    });
  };

  /**
   * @description Find usage records by month.
   * @param mo Month
   * @returns UsageRecordItem[]
   */
  findByMonth = async (mo?: string): Promise<UsageRecordItem[]> => {
    let startAt: string;
    let endAt: string;
    if (mo && dayjs(mo, 'YYYY-MM', true).isValid()) {
      startAt = dayjs(mo, 'YYYY-MM').startOf('month').format('YYYY-MM-DD');
      endAt = dayjs(mo, 'YYYY-MM').endOf('month').format('YYYY-MM-DD');
    } else {
      startAt = dayjs().startOf('month').format('YYYY-MM-DD');
      endAt = dayjs().endOf('month').format('YYYY-MM-DD');
    }
    return this.findByDateRange(startAt, endAt);
  };

  /**
   * @description Group usage records by day for a given date range.
   */
  private groupByDay = (
    spends: UsageRecordItem[],
    startAt: string,
    endAt: string,
    pad = true,
  ): UsageLog[] => {
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
        totalTokens,
      });
    });

    if (!pad) return usageLogs;

    // Padding to ensure the date range is complete
    const startDate = dayjs(startAt);
    const endDate = dayjs(endAt);
    const paddedUsageLogs: UsageLog[] = [];
    log(
      'Padding usage logs from',
      startDate.format('YYYY-MM-DD'),
      'to',
      endDate.format('YYYY-MM-DD'),
    );
    for (let date = startDate; date.isBefore(endDate); date = date.add(1, 'day')) {
      const found = usageLogs.find((l) => l.day === date.format('YYYY-MM-DD'));
      if (found) {
        paddedUsageLogs.push(found);
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

  findAndGroupByDay = async (mo?: string): Promise<UsageLog[]> => {
    let startAt: string;
    let endAt: string;
    if (mo && dayjs(mo, 'YYYY-MM', true).isValid()) {
      startAt = dayjs(mo, 'YYYY-MM').startOf('month').format('YYYY-MM-DD');
      endAt = dayjs(mo, 'YYYY-MM').endOf('month').format('YYYY-MM-DD');
    } else {
      startAt = dayjs().startOf('month').format('YYYY-MM-DD');
      endAt = dayjs().endOf('month').format('YYYY-MM-DD');
    }
    const spends = await this.findByDateRange(startAt, endAt);
    return this.groupByDay(spends, startAt, endAt);
  };

  /**
   * @description Find usage grouped by day for a custom date range (e.g. past 12 months).
   * Does not pad missing days for large ranges.
   */
  /**
   * @description Find usage records by date range for all users (admin only).
   */
  findAllByDateRange = async (startAt: string, endAt: string): Promise<UsageRecordItem[]> => {
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
        spend: metadata?.cost || 0,
        totalInputTokens: metadata?.totalInputTokens || 0,
        totalOutputTokens: metadata?.totalOutputTokens || 0,
        totalTokens: (metadata?.totalInputTokens || 0) + (metadata?.totalOutputTokens || 0),
        tps: metadata?.tps || 0,
        ttft: metadata?.ttft || 0,
        type: 'chat',
        updatedAt: spend.createdAt,
        userId: spend.userId,
      } as UsageRecordItem;
    });
  };

  findAllByMonth = async (mo?: string): Promise<UsageRecordItem[]> => {
    let startAt: string;
    let endAt: string;
    if (mo && dayjs(mo, 'YYYY-MM', true).isValid()) {
      startAt = dayjs(mo, 'YYYY-MM').startOf('month').format('YYYY-MM-DD');
      endAt = dayjs(mo, 'YYYY-MM').endOf('month').format('YYYY-MM-DD');
    } else {
      startAt = dayjs().startOf('month').format('YYYY-MM-DD');
      endAt = dayjs().endOf('month').format('YYYY-MM-DD');
    }
    return this.findAllByDateRange(startAt, endAt);
  };

  findAllAndGroupByDay = async (mo?: string): Promise<UsageLog[]> => {
    let startAt: string;
    let endAt: string;
    if (mo && dayjs(mo, 'YYYY-MM', true).isValid()) {
      startAt = dayjs(mo, 'YYYY-MM').startOf('month').format('YYYY-MM-DD');
      endAt = dayjs(mo, 'YYYY-MM').endOf('month').format('YYYY-MM-DD');
    } else {
      startAt = dayjs().startOf('month').format('YYYY-MM-DD');
      endAt = dayjs().endOf('month').format('YYYY-MM-DD');
    }
    const spends = await this.findAllByDateRange(startAt, endAt);
    return this.groupByDay(spends, startAt, endAt);
  };

  findAllAndGroupByDateRange = async (startAt: string, endAt: string): Promise<UsageLog[]> => {
    const spends = await this.findAllByDateRange(startAt, endAt);
    return this.groupByDay(spends, startAt, endAt, false);
  };

  /**
   * @description Find usage records for a specific user by month (admin only).
   */
  findByUserAndMonth = async (targetUserId: string, mo?: string): Promise<UsageRecordItem[]> => {
    let startAt: string;
    let endAt: string;
    if (mo && dayjs(mo, 'YYYY-MM', true).isValid()) {
      startAt = dayjs(mo, 'YYYY-MM').startOf('month').format('YYYY-MM-DD');
      endAt = dayjs(mo, 'YYYY-MM').endOf('month').format('YYYY-MM-DD');
    } else {
      startAt = dayjs().startOf('month').format('YYYY-MM-DD');
      endAt = dayjs().endOf('month').format('YYYY-MM-DD');
    }
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
          eq(messages.userId, targetUserId),
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
        spend: metadata?.cost || 0,
        totalInputTokens: metadata?.totalInputTokens || 0,
        totalOutputTokens: metadata?.totalOutputTokens || 0,
        totalTokens: (metadata?.totalInputTokens || 0) + (metadata?.totalOutputTokens || 0),
        tps: metadata?.tps || 0,
        ttft: metadata?.ttft || 0,
        type: 'chat',
        updatedAt: spend.createdAt,
        userId: spend.userId,
      } as UsageRecordItem;
    });
  };

  /**
   * @description Find usage records for all users in a department by month (admin only).
   */
  findByDepartmentAndMonth = async (
    department: string,
    mo?: string,
  ): Promise<UsageRecordItem[]> => {
    const deptUsers = await this.db.query.users.findMany({
      columns: { id: true, interests: true },
    });
    const userIds = deptUsers
      .filter((u) => (u.interests?.[0] ?? '其他') === department)
      .map((u) => u.id);

    if (userIds.length === 0) return [];

    let startAt: string;
    let endAt: string;
    if (mo && dayjs(mo, 'YYYY-MM', true).isValid()) {
      startAt = dayjs(mo, 'YYYY-MM').startOf('month').format('YYYY-MM-DD');
      endAt = dayjs(mo, 'YYYY-MM').endOf('month').format('YYYY-MM-DD');
    } else {
      startAt = dayjs().startOf('month').format('YYYY-MM-DD');
      endAt = dayjs().endOf('month').format('YYYY-MM-DD');
    }

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
          inArray(messages.userId, userIds),
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
        spend: metadata?.cost || 0,
        totalInputTokens: metadata?.totalInputTokens || 0,
        totalOutputTokens: metadata?.totalOutputTokens || 0,
        totalTokens: (metadata?.totalInputTokens || 0) + (metadata?.totalOutputTokens || 0),
        tps: metadata?.tps || 0,
        ttft: metadata?.ttft || 0,
        type: 'chat',
        updatedAt: spend.createdAt,
        userId: spend.userId,
      } as UsageRecordItem;
    });
  };

  findAllByDepartment = async (
    mo?: string,
  ): Promise<
    { department: string; totalSpend: number; totalTokens: number; totalRequests: number }[]
  > => {
    const records = await this.findAllByMonth(mo);

    const userDepts = await this.db.query.users.findMany({
      columns: { id: true, interests: true },
    });
    const deptMap = new Map(userDepts.map((u) => [u.id, u.interests?.[0] ?? '其他']));

    const grouped = new Map<
      string,
      { totalSpend: number; totalTokens: number; totalRequests: number }
    >();
    for (const r of records) {
      const dept = deptMap.get(r.userId ?? '') ?? '其他';
      const existing = grouped.get(dept) ?? { totalRequests: 0, totalSpend: 0, totalTokens: 0 };
      grouped.set(dept, {
        totalRequests: existing.totalRequests + 1,
        totalSpend: existing.totalSpend + r.spend,
        totalTokens: existing.totalTokens + (r.totalTokens || 0),
      });
    }

    return Array.from(grouped.entries()).map(([department, stats]) => ({ department, ...stats }));
  };

  findAndGroupByDateRange = async (startAt: string, endAt: string): Promise<UsageLog[]> => {
    const spends = await this.findByDateRange(startAt, endAt);
    return this.groupByDay(spends, startAt, endAt, false);
  };

  checkQuota = async (): Promise<QuotaCheckResult> => {
    const today = dayjs().format('YYYY-MM-DD');
    const monthStart = dayjs().startOf('month').format('YYYY-MM-DD');
    const monthEnd = dayjs().endOf('month').format('YYYY-MM-DD');

    // 1. Fetch user limits + department
    const user = await this.db.query.users.findFirst({
      columns: {
        dailyCostLimit: true,
        dailyTokenLimit: true,
        interests: true,
        monthlyCostLimit: true,
        monthlyTokenLimit: true,
      },
      where: eq(users.id, this.userId),
    });

    // 2. Fetch department limits
    const department = user?.interests?.[0];
    let deptQuota = null;
    if (department) {
      deptQuota = await this.db.query.departmentQuotas.findFirst({
        where: eq(departmentQuotas.department, department),
      });
    }

    // 3. Effective limit = min(user, dept), null means no limit
    const minLimit = (a: number | null | undefined, b: number | null | undefined) => {
      if (a == null && b == null) return null;
      if (a == null) return b ?? null;
      if (b == null) return a;
      return Math.min(a, b);
    };

    const effectiveDailyCostLimit = minLimit(user?.dailyCostLimit, deptQuota?.dailyCostLimit);
    const effectiveMonthlyCostLimit = minLimit(user?.monthlyCostLimit, deptQuota?.monthlyCostLimit);
    const effectiveDailyTokenLimit = minLimit(user?.dailyTokenLimit, deptQuota?.dailyTokenLimit);
    const effectiveMonthlyTokenLimit = minLimit(
      user?.monthlyTokenLimit,
      deptQuota?.monthlyTokenLimit,
    );

    // 4. Query today's and this month's usage
    const todayRecords = await this.findByDateRange(today, today);
    const monthRecords = await this.findByDateRange(monthStart, monthEnd);

    const todayCost = todayRecords.reduce((s, r) => s + r.spend, 0);
    const todayTokens = todayRecords.reduce((s, r) => s + (r.totalTokens || 0), 0);
    const monthlyCost = monthRecords.reduce((s, r) => s + r.spend, 0);
    const monthlyTokens = monthRecords.reduce((s, r) => s + (r.totalTokens || 0), 0);

    // 5. Determine status (worst across all dimensions)
    const ratio = (used: number, limit: number | null) =>
      limit != null && limit > 0 ? used / limit : 0;
    const maxRatio = Math.max(
      ratio(todayCost, effectiveDailyCostLimit),
      ratio(todayTokens, effectiveDailyTokenLimit),
      ratio(monthlyCost, effectiveMonthlyCostLimit),
      ratio(monthlyTokens, effectiveMonthlyTokenLimit),
    );

    const status = maxRatio >= 1 ? 'exceeded' : maxRatio >= 0.8 ? 'warning' : 'ok';

    return {
      effectiveDailyCostLimit,
      effectiveDailyTokenLimit,
      effectiveMonthlyCostLimit,
      effectiveMonthlyTokenLimit,
      monthlyCost,
      monthlyTokens,
      status,
      todayCost,
      todayTokens,
    };
  };
}
