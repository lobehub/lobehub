import { parseExpertiseDomainBrief } from '@lobechat/types';
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import {
  expertiseBindings,
  expertiseDomains,
  expertiseDomainSnapshots,
  expertiseHits,
  expertiseInsights,
  expertiseLessons,
  expertiseRuns,
  topics,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { idGenerator } from '../utils/idGenerator';
import { buildWorkspaceWhere } from '../utils/workspace';

/**
 * 命中梯队的切点：本专长最高命中的 40%，下限 2。
 *
 * 用相对值而不是绝对阈值 —— 实测代码评审练了 47 次、UX 审计只练了 2 次，
 * 同一个绝对阈值必然误伤后者。
 */
const CORE_CUT_RATIO = 0.4;
const CORE_CUT_MIN = 2;

export type ExpertiseTier = 'core' | 'niche' | 'unused';

export class ExpertiseModel {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private scopeWhere = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, expertiseDomains);

  // ========== 挂载解析 ==========

  /**
   * 一个 agent 能用到的专长。
   *
   * 挂载是叠加的：workspace 上挂的、project 上挂的、agent 上挂的都算。这里先做
   * agent + workspace 两级 —— project 级要等 agent 所属 project 的解析链路接上。
   */
  listDomainsForAgent = async (agentId: string) => {
    const rows = await this.db
      .select({
        binding: {
          contributionMode: expertiseBindings.contributionMode,
          enabled: expertiseBindings.enabled,
          id: expertiseBindings.id,
          sortOrder: expertiseBindings.sortOrder,
        },
        domain: expertiseDomains,
      })
      .from(expertiseBindings)
      .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseBindings.domainId))
      .where(
        and(
          eq(expertiseBindings.enabled, true),
          isNotNull(expertiseDomains.anchorChosenAt),
          or(
            eq(expertiseBindings.agentId, agentId),
            this.workspaceId
              ? eq(expertiseBindings.boundWorkspaceId, this.workspaceId)
              : eq(expertiseBindings.boundUserId, this.userId),
          ),
        ),
      )
      .orderBy(asc(expertiseBindings.sortOrder));

    // 同一个专长可能同时挂在 agent 和 workspace 上，去重保留排序靠前的那条绑定
    const seen = new Set<string>();
    return rows.filter((r) => {
      if (seen.has(r.domain.id)) return false;
      seen.add(r.domain.id);
      return true;
    });
  };

  // ========== L0：概览 ==========

  /**
   * 每个专长的最新快照 —— L0 的曲线、成熟度、覆盖率都读它。
   *
   * 用 DISTINCT ON 取每个 domain 的最大 runIndex，避免把整张时间序列拉回来。
   */
  latestSnapshots = async (domainIds: string[]) => {
    if (domainIds.length === 0) return [];
    return this.db
      .selectDistinctOn([expertiseDomainSnapshots.domainId])
      .from(expertiseDomainSnapshots)
      .where(inArray(expertiseDomainSnapshots.domainId, domainIds))
      .orderBy(desc(expertiseDomainSnapshots.domainId), desc(expertiseDomainSnapshots.runIndex));
  };

  /**
   * L0 叠图要的时间序列：每个专长的完整 (runIndex, activeCount)。
   *
   * 一次查完所有专长，不按域循环 —— 十个专长就是十次往返，而这张图的全部意义
   * 就是把它们放在一起看。
   */
  seriesForDomains = async (domainIds: string[]) => {
    if (domainIds.length === 0) return [];
    return this.db
      .select({
        activeCount: expertiseDomainSnapshots.activeCount,
        domainId: expertiseDomainSnapshots.domainId,
        runIndex: expertiseDomainSnapshots.runIndex,
      })
      .from(expertiseDomainSnapshots)
      .where(inArray(expertiseDomainSnapshots.domainId, domainIds))
      .orderBy(asc(expertiseDomainSnapshots.domainId), asc(expertiseDomainSnapshots.runIndex));
  };

  /** 每个专长有哪些 agent 在学 —— L0 列表上直接显示。 */
  actorsByDomain = async (domainIds: string[]) => {
    if (domainIds.length === 0) return [];
    return this.db
      .selectDistinct({ actorId: expertiseRuns.actorId, domainId: expertiseRuns.domainId })
      .from(expertiseRuns)
      .where(and(inArray(expertiseRuns.domainId, domainIds), eq(expertiseRuns.actorType, 'agent')));
  };

  // ========== L1：专长详情 ==========

  findDomain = async (domainId: string) => {
    const [row] = await this.db
      .select()
      .from(expertiseDomains)
      .where(
        and(
          eq(expertiseDomains.id, domainId),
          isNotNull(expertiseDomains.anchorChosenAt),
          this.scopeWhere(),
        ),
      )
      .limit(1);
    return row;
  };

  /** 完整的时间序列 —— 累计曲线与柱状图都由它渲染。 */
  listSnapshots = async (domainId: string) =>
    this.db
      .select()
      .from(expertiseDomainSnapshots)
      .where(eq(expertiseDomainSnapshots.domainId, domainId))
      .orderBy(asc(expertiseDomainSnapshots.runIndex));

  listRuns = async (domainId: string, limit = 50) =>
    this.db
      .select()
      .from(expertiseRuns)
      .where(eq(expertiseRuns.domainId, domainId))
      .orderBy(desc(expertiseRuns.runIndex))
      .limit(limit);

  /**
   * 「练过多少次」必须自己查 count，不能用 listRuns 的长度。
   *
   * 上一轮验收就栽在这儿：分页上限 50 被当成了业务计数，练到 60 次的专长在左栏
   * 显示 60、在详情页显示 50，而且越练越久这个数字越是卡住不动 —— 偏偏是在成熟度
   * 最需要被信任的时候。
   */
  countRuns = async (domainId: string) => {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(expertiseRuns)
      .where(eq(expertiseRuns.domainId, domainId));
    return row?.n ?? 0;
  };

  /**
   * 每次实践有没有人在场。
   *
   * 图上那根柱因此分两色：有人参与的那几次通常是学得最快的几次，这个对比本身
   * 就是一条结论 —— 「没你参与的实践平均只学到 0.8 条」。丢掉这一位，柱子就只剩
   * 「涨了多少」，看不出为什么涨。
   */
  runHumanFlags = async (domainId: string) =>
    this.db
      .select({
        hadHumanInLoop: expertiseRuns.hadHumanInLoop,
        runIndex: expertiseRuns.runIndex,
      })
      .from(expertiseRuns)
      .where(eq(expertiseRuns.domainId, domainId))
      .orderBy(asc(expertiseRuns.runIndex));

  /** 规则库的汇总：条数、总命中、零命中条数 —— 头部那行统计读它。 */
  lessonStats = async (domainId: string) => {
    const [row] = await this.db
      .select({
        hits: sql<number>`coalesce(sum(${expertiseLessons.hitCount}), 0)::int`,
        total: sql<number>`count(*)::int`,
        unused: sql<number>`count(*) filter (where ${expertiseLessons.hitCount} = 0)::int`,
      })
      .from(expertiseLessons)
      .where(and(eq(expertiseLessons.domainId, domainId), eq(expertiseLessons.status, 'active')));
    return row ?? { hits: 0, total: 0, unused: 0 };
  };

  // ========== L2：规则库 ==========

  /**
   * 规则列表，按命中降序 —— 流水账按时间排，判断系统按命中排。
   * 梯队（骨干 / 专用 / 没用上的）在这里算好，避免前端重复实现切点逻辑。
   */
  listLessons = async (domainId: string, opts?: { layer?: string; search?: string }) => {
    const conditions = [
      eq(expertiseLessons.domainId, domainId),
      eq(expertiseLessons.status, 'active'),
    ];
    if (opts?.layer) conditions.push(eq(expertiseLessons.layer, opts.layer));
    if (opts?.search) {
      conditions.push(sql`${expertiseLessons.title} ILIKE ${`%${opts.search}%`}`);
    }

    const rows = await this.db
      .select()
      .from(expertiseLessons)
      .where(and(...conditions))
      .orderBy(desc(expertiseLessons.hitCount), asc(expertiseLessons.code));

    const maxHit = rows.reduce((a, r) => Math.max(a, r.hitCount), 0);
    const cut = Math.max(CORE_CUT_MIN, Math.round(maxHit * CORE_CUT_RATIO));

    return rows.map((r) => ({
      ...r,
      tier: (r.hitCount >= cut ? 'core' : r.hitCount > 0 ? 'niche' : 'unused') as ExpertiseTier,
    }));
  };

  /** 分层覆盖：哪几层有规则、哪几层是空的。空层是 canonical 分层照出来的真缺口。 */
  layerCounts = async (domainId: string) => {
    const rows = await this.db
      .select({ layer: expertiseLessons.layer, n: sql<number>`count(*)::int` })
      .from(expertiseLessons)
      .where(and(eq(expertiseLessons.domainId, domainId), eq(expertiseLessons.status, 'active')))
      .groupBy(expertiseLessons.layer);
    return Object.fromEntries(rows.filter((r) => r.layer).map((r) => [r.layer!, r.n]));
  };

  /** Canon 覆盖：哪些条目被锚过。锚不上的规则（null）单独计一格。 */
  canonAnchorCounts = async (domainId: string) => {
    const rows = await this.db
      .select({ anchor: expertiseLessons.canonAnchor, n: sql<number>`count(*)::int` })
      .from(expertiseLessons)
      .where(and(eq(expertiseLessons.domainId, domainId), eq(expertiseLessons.status, 'active')))
      .groupBy(expertiseLessons.canonAnchor);
    return {
      byKey: Object.fromEntries(rows.filter((r) => r.anchor).map((r) => [r.anchor!, r.n])),
      unanchored: rows.find((r) => !r.anchor)?.n ?? 0,
    };
  };

  // ========== L3：单条规则 ==========

  findLesson = async (lessonId: string) => {
    const [row] = await this.db
      .select()
      .from(expertiseLessons)
      .where(eq(expertiseLessons.id, lessonId))
      .limit(1);
    return row;
  };

  /**
   * 一条规则的命中记录 —— pass 是 ✅ 例子，violation 是 ❌ 例子。
   * 带上 run 的 subject，「最近一次在哪」可以直接点回那个 topic。
   */
  listLessonHits = async (lessonId: string, limit = 20) =>
    this.db
      .select({
        createdAt: expertiseHits.createdAt,
        example: expertiseHits.example,
        note: expertiseHits.note,
        outcome: expertiseHits.outcome,
        runIndex: expertiseRuns.runIndex,
        runTitle: sql<string>`coalesce(${topics.title}, ${expertiseRuns.subjectId})`,
        severity: expertiseHits.severity,
        subjectId: expertiseRuns.subjectId,
        subjectType: expertiseRuns.subjectType,
        where: expertiseHits.where,
      })
      .from(expertiseHits)
      .innerJoin(expertiseRuns, eq(expertiseRuns.id, expertiseHits.runId))
      .leftJoin(
        topics,
        and(eq(expertiseRuns.subjectType, 'topic'), eq(topics.id, expertiseRuns.subjectId)),
      )
      .where(eq(expertiseHits.lessonId, lessonId))
      .orderBy(desc(expertiseHits.createdAt))
      .limit(limit);

  // ========== 写入 ==========

  /**
   * 人手建一个专长。
   *
   * 人自己写下的领域过滤器**就是一个已选定的锚点** —— 锚定阶段的价值在于「有人拍了板」，
   * 模型提候选只是帮人省事。所以这里直接 anchorChosenAt = now，不留一个必须再点一次的中间态。
   */
  /**
   * 一句话建一个专长。
   *
   * 验收原话是「填写太麻烦了，能否改成一个输入框直接填写，然后我们做后台解析」。
   * 用户写一句「我想让它在处理线上故障上变强，方案讨论不算」，这里拆成名称与领域过滤器。
   *
   * 解析目前是规则式的：首句／首个分句当名称，整段当过滤器。**不假装它是理解**——
   * 真正的锚定要从这个 agent 的语料里读候选（那条路径还没实现），到位之后这里换成它。
   * 规则式的代价是名称可能拗口，所以名称随时可改，而过滤器保留用户的原话不做改写：
   * 过滤器是这个专长唯一可执行的判据，改写它等于替用户改了判断标准。
   */
  createDomain = async (params: {
    agentId: string;
    brief: string;
    domainFilter?: string;
    title?: string;
  }) => {
    const brief = params.brief.trim();
    const id = idGenerator('expertiseDomains');
    const parsed = parseExpertiseDomainBrief(brief);
    const title = params.title?.trim() || parsed.title;
    const domainFilter = params.domainFilter?.trim() || parsed.domainFilter;
    const slug = `${title.slice(0, 40).replaceAll(/\s+/g, '-').toLowerCase()}-${id.slice(-6)}`;

    await this.db.transaction(async (tx) => {
      await tx.insert(expertiseDomains).values({
        anchorChosenAt: new Date(),
        anchorChosenByUserId: this.userId,
        description: brief,
        domainFilter,
        id,
        seedState: 'seeded',
        slug,
        title,
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
      await tx.insert(expertiseBindings).values({
        addedByUserId: this.userId,
        agentId: params.agentId,
        domainId: id,
        workspaceId: this.workspaceId,
      });
    });
    return id;
  };

  // ========== 洞察 ==========

  listInsights = async (domainIds: string[]) => {
    if (domainIds.length === 0) return [];
    return this.db
      .select()
      .from(expertiseInsights)
      .where(
        and(
          or(inArray(expertiseInsights.domainId, domainIds), isNull(expertiseInsights.domainId)),
          eq(expertiseInsights.status, 'active'),
          eq(expertiseInsights.userId, this.userId),
        ),
      )
      .orderBy(desc(expertiseInsights.confidence))
      .limit(10);
  };

  dismissInsight = async (insightId: string, reason?: string) =>
    this.db
      .update(expertiseInsights)
      .set({ dismissReason: reason, status: 'dismissed', updatedAt: new Date() })
      .where(and(eq(expertiseInsights.id, insightId), eq(expertiseInsights.userId, this.userId)));
}
