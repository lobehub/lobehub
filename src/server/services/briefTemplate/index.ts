import {
  BRIEF_TEMPLATE_FALLBACK_CATEGORIES,
  type BriefTemplate,
  briefTemplates,
  getBriefTemplateById,
  INBOX_SESSION_ID,
} from '@lobechat/const';
import { and, eq } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import { AgentCronJobModel } from '@/database/models/agentCronJob';
import { agentCronJobs } from '@/database/schemas/agentCronJob';
import type { LobeChatDatabase } from '@/database/type';

export const RECOMMEND_COUNT = 3;

const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
};

/** mulberry32 — pure function of seed, used so recommendations are stable per user/day. */
const mulberry32 = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d_2b_79_f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const seededShuffle = <T>(items: T[], seed: number): T[] => {
  const arr = [...items];
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const normalize = (s: string) => s.trim().toLowerCase();

const hasIntersection = (template: BriefTemplate, userInterests: string[]): boolean => {
  if (userInterests.length === 0) return false;
  const normalized = new Set(userInterests.map(normalize));
  return template.interests.some((i) => normalized.has(normalize(i)));
};

const getUtcDateStr = (now: Date): string => now.toISOString().slice(0, 10);

export class BriefTemplateService {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
  ) {}

  /**
   * Client resolves user.interests (localized labels or raw values) to
   * INTEREST_AREAS keys before calling — see useResolvedInterestKeys in the UI.
   */
  async listDailyRecommend(
    interestKeys: string[],
    now: Date = new Date(),
  ): Promise<BriefTemplate[]> {
    const seed = hashString(`${this.userId}:${getUtcDateStr(now)}`);

    const matched = briefTemplates.filter((t) => hasIntersection(t, interestKeys));
    const result: BriefTemplate[] = seededShuffle(matched, seed).slice(0, RECOMMEND_COUNT);

    const takeFrom = (pool: BriefTemplate[]) => {
      if (result.length >= RECOMMEND_COUNT) return;
      const seen = new Set(result.map((t) => t.id));
      const remaining = pool.filter((t) => !seen.has(t.id));
      result.push(...seededShuffle(remaining, seed).slice(0, RECOMMEND_COUNT - result.length));
    };

    takeFrom(briefTemplates.filter((t) => BRIEF_TEMPLATE_FALLBACK_CATEGORIES.includes(t.category)));
    takeFrom(briefTemplates);

    return result;
  }

  /** Idempotent on (userId, title): re-creating the same template returns the existing cron job. */
  async createFromTemplate(params: { prompt: string; templateId: string; title: string }) {
    const template = getBriefTemplateById(params.templateId);
    if (!template) {
      throw new Error(`Brief template not found: ${params.templateId}`);
    }

    const [existing] = await this.db
      .select()
      .from(agentCronJobs)
      .where(and(eq(agentCronJobs.userId, this.userId), eq(agentCronJobs.name, params.title)))
      .limit(1);

    if (existing) return { alreadyExists: true as const, data: existing };

    const agentModel = new AgentModel(this.db, this.userId);
    const inbox = await agentModel.getBuiltinAgent(INBOX_SESSION_ID);
    if (!inbox) {
      throw new Error('Inbox agent unavailable');
    }

    const cronJobModel = new AgentCronJobModel(this.db, this.userId);
    const created = await cronJobModel.create({
      agentId: inbox.id,
      content: params.prompt,
      cronPattern: template.cronPattern,
      name: params.title,
      timezone: 'UTC',
    });

    return { alreadyExists: false as const, data: created };
  }
}
