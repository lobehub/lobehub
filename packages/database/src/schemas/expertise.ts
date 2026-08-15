import type {
  ExpertiseAnchorCandidate,
  ExpertiseCanonEntry,
  ExpertiseEvidenceSpecItem,
  ExpertiseInsightEvidenceRef,
  ExpertiseLayerDefinition,
  ExpertiseLessonSection,
} from '@lobechat/types';
import { isNotNull, isNull, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps, timestamptz, varchar255 } from './_helpers';
import { agents } from './agent';
import { agentOperations } from './agentOperations';
import { documents } from './file';
import { projects } from './project';
import { users } from './user';
import { verifyCriteria, verifyEvidence } from './verify';
import { workspaces } from './workspace';

/**
 * Expertise —— SCLPT 自进化体系的数据层。
 *
 * 与 verify 的关系是**编译**，不是同一层：
 *   经验（人读的心得，注入上下文）──成熟到可程序化──▶ verify criterion（机器能跑）
 * 所以心得表独立存在，成熟后单向编译出 criterion 并回填 compiledCriterionId。
 * 心智模型层的心得永远编译不出来，那正是人类专家不可替代的部分。
 *
 * 表的分工：
 *   domains    专长本体 + SCLPT 的非 P 部分（过滤器 / 分层 / Canon / 流程 / 证据规格）
 *   bindings   挂载到 agent / project / workspace / user
 *   lessons    P —— 心得，四段结构化正文
 *   revisions  对话改写的版本链
 *   runs       一次实践，边界复用 reflection 的时间窗口
 *   hits       命中 —— 「这次用上了哪几条」，整个 L2 界面的地基
 *   snapshots  每次实践后的时间序列快照，喂全部曲线与成熟度
 *   insights   跨多次实践才看得出的元模式，由定时分析作业产出
 */

export const EXPERTISE_DOMAIN_SOURCES = ['market', 'user'] as const;
export const EXPERTISE_LAYER_SOURCES = ['canonical', 'invented'] as const;
export const EXPERTISE_SEED_STATES = ['seeding', 'seeded'] as const;
export const EXPERTISE_CONTRIBUTION_MODES = ['read-only', 'contribute', 'derive'] as const;
export const EXPERTISE_LESSON_POLARITIES = ['bad', 'good', 'rule'] as const;
export const EXPERTISE_LESSON_STATUSES = ['active', 'rejected', 'retired'] as const;
export const EXPERTISE_COMPILABILITIES = ['compiled', 'compilable', 'not-compilable'] as const;
export const EXPERTISE_ACTOR_TYPES = ['agent', 'user', 'system'] as const;
export const EXPERTISE_SUBJECT_TYPES = ['topic', 'task', 'document'] as const;
/**
 * 只有两值。早期有第三值 false_positive，实测被系统性误用：模型把「这条规则在
 * 这个 topic 不适用」记成了 fp（消息回复 fp 29 > pass 19）。但 fp 的本意是
 * 「被用上了但用错了」，是喂给用进废退的降级信号 —— 照那样记，每条规则只要在
 * 不相关的 topic 出现一次就被扣分。**不适用根本不该产生 hit**；真正的误报由
 * userDecision = 'reject' 承担。
 */
export const EXPERTISE_HIT_OUTCOMES = ['pass', 'violation'] as const;
export const EXPERTISE_HIT_SEVERITIES = ['high', 'mid', 'low'] as const;
export const EXPERTISE_HIT_USER_DECISIONS = ['agree', 'reject'] as const;
export const EXPERTISE_FIT_CONFIDENCES = ['insufficient', 'low', 'ok'] as const;
export const EXPERTISE_INSIGHT_STATUSES = ['active', 'dismissed', 'acted'] as const;
export const EXPERTISE_REVISION_ACTORS = ['user', 'agent', 'system'] as const;
/** 改写的两种来源：人把边界说清楚了 vs 合并时被泛化以覆盖新实例。 */
export const EXPERTISE_REVISION_KINDS = ['user-feedback', 'generalize'] as const;
/**
 * 零命中有两种病，处置不同：
 *   over-specific  触发条件写死成某个角色/平台 → 该并回母规则
 *   one-off        真的罕见 → 保留或退休
 * 实测：找人专家的零命中 90% 带「当…时」条件从句，设计工程师的 0% 带 —— 同一档两种病。
 */
export const EXPERTISE_SPECIFICITIES = ['general', 'over-specific', 'one-off'] as const;
/** 曲线形态。区分「真饱和」与「从没起来过」是旧版最大的漏洞。 */
export const EXPERTISE_PLATEAU_KINDS = ['saturated', 'growing', 'stalled', 'noisy'] as const;

// ============================================
// 1. expertise_domains — 专长本体 + SCLPT 的非 P 部分
// ============================================

export const expertiseDomains = pgTable(
  'expertise_domains',
  {
    id: varchar255('id')
      .$defaultFn(() => idGenerator('expertiseDomains'))
      .primaryKey(),

    slug: varchar255('slug').notNull(),
    title: text('title').notNull(),
    description: text('description'),

    // ---- 所有权（不是使用权）。对齐 projects / documents 的写法 ----
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    visibility: text('visibility', { enum: ['private', 'public'] })
      .notNull()
      .default('private'),
    source: text('source', { enum: EXPERTISE_DOMAIN_SOURCES }).notNull().default('user'),

    /**
     * 派生。挂载了别人的领域但要本地积累时 fork 一份：继承 canon + layers +
     * domainFilter，心得叠加。刻意限制一层 —— 多层继承的合并语义会失控。
     */
    parentDomainId: varchar255('parent_domain_id').references(
      (): AnyPgColumn => expertiseDomains.id,
      { onDelete: 'set null' },
    ),

    // ---- SCLPT 的非 P 部分：这些是产品可见内容，不是文档 ----
    /**
     * P 的守门判据，建域必填。例：「把所有框架名、表名、组件名去掉，还剩下产品洞察吗？」
     * notNull 是刻意的：没有它，Pattern Base 会在几个月内变成什么都装的桶。
     */
    domainFilter: text('domain_filter').notNull(),
    /** 明确写出什么不属于这个领域。 */
    outOfScope: text('out_of_scope'),

    /**
     * L —— 分层模型，归属于专长而不是全局枚举：
     * Cooper 三模型 / 正确性-可维护性-安全性 / L1-L2-L3 各不相同。
     * canonRef 记这一层抄的哪本经典；自己发明的分层会让你看不见经典能看见的东西。
     */
    layers: jsonb('layers').$type<ExpertiseLayerDefinition[]>().notNull().default([]),
    layerSource: text('layer_source', { enum: EXPERTISE_LAYER_SOURCES })
      .notNull()
      .default('invented'),

    /**
     * Canon —— 外部基准，**条目化**。
     *
     * 早期这里是一句话文本，结果 lesson 的 canonAnchor 100% 是 null ——
     * 锚点不可引用就锚不上；改成条目后锚定率跳到 100%。
     *
     * 与 layers 同样用 jsonb 而不抽表：每个领域 7-8 条且固定，读取永远是全量
     * （喂 prompt、算覆盖率），9 个真实领域之间零复用。lesson.canonAnchor 用
     * key 引用它，与 lesson.layer 引用 layers[].key 是同一个取舍。
     */
    canonEntries: jsonb('canon_entries').$type<ExpertiseCanonEntry[]>().notNull().default([]),
    /** 整本经典的全文或引用材料 —— 条目是索引，文档是原文。 */
    canonDocumentId: varchar255('canon_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),

    /** 一次实践怎么走。 */
    flow: jsonb('flow').$type<string[]>().notNull().default([]),

    /**
     * T —— 一次实践必须留下哪些证据。run 收尾时按它校验，缺的要标出来。
     * 挂了 layer 的条目只在跑那一层时要求：例如 UX 审计把 screenshot 挂在 L2 且
     * required，没截图就不允许下 L2 的结论。
     */
    evidenceSpec: jsonb('evidence_spec').$type<ExpertiseEvidenceSpecItem[]>().notNull().default([]),

    /** 心得库的 markdown 投影，挂 agent_documents 做确定性注入。 */
    lessonBaseDocumentId: varchar255('lesson_base_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),

    /**
     * 锚定阶段给出的候选全集。领域是**选择**不是发现 —— 同一个 agent 锚两次
     * 可能得到两个都成立的身份（技术情报分析 / 论文解读），各带不同的 canon
     * 与分层。没选的那条路也留着，后面才能回答「当时选另一个会怎样」。
     */
    anchorCandidates: jsonb('anchor_candidates').$type<ExpertiseAnchorCandidate[]>(),
    /**
     * 人在什么时候定下了锚点。null = 还没定 —— 此时**禁止开始长规则**，
     * 因为下游的分层、canon、过滤器全部依赖这个选择。
     */
    anchorChosenAt: timestamptz('anchor_chosen_at'),
    anchorChosenByUserId: text('anchor_chosen_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    /** 种子那次实践必然饱和，不计入成熟度判断。 */
    seedState: text('seed_state', { enum: EXPERTISE_SEED_STATES }).notNull().default('seeding'),
    /** 不加 FK，避免与 runs 循环引用；由 service 保证一致。 */
    seedRunId: uuid('seed_run_id'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('expertise_domains_slug_user_unique')
      .on(t.slug, t.userId)
      .where(isNull(t.workspaceId)),
    uniqueIndex('expertise_domains_slug_workspace_unique')
      .on(t.workspaceId, t.slug)
      .where(isNotNull(t.workspaceId)),
    index('expertise_domains_user_id_idx').on(t.userId),
    index('expertise_domains_workspace_visibility_idx').on(t.workspaceId, t.visibility),
    index('expertise_domains_parent_idx').on(t.parentDomainId),
  ],
);

export type ExpertiseDomainItem = typeof expertiseDomains.$inferSelect;
export type NewExpertiseDomain = typeof expertiseDomains.$inferInsert;

// ============================================
// 2. expertise_bindings — 挂载（exclusive arc）
// ============================================

/**
 * 专长挂在载体上，载体不拥有它 —— 与 project_knowledge_bases 同样的语义。
 *
 * 用 exclusive arc（四个 nullable FK + 恰好一个非空）而不是 carrier 侧多态：
 * 载体是封闭且已知的集合，多态的正当理由不成立；FK 完整性换来删载体自动级联，
 * 不需要额外的 GC。
 */
export const expertiseBindings = pgTable(
  'expertise_bindings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    domainId: varchar255('domain_id')
      .notNull()
      .references(() => expertiseDomains.id, { onDelete: 'cascade' }),

    agentId: text('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    boundWorkspaceId: text('bound_workspace_id').references(() => workspaces.id, {
      onDelete: 'cascade',
    }),
    boundUserId: text('bound_user_id').references(() => users.id, { onDelete: 'cascade' }),

    /**
     * 挂载是消费还是共建 —— 决定新心得写到哪里。
     * derive 是默认：挂载公共领域时，本地踩的坑不该污染公共库，也不该泄漏出去，
     * 首次产出新心得时自动 fork 一个私有域。
     */
    contributionMode: text('contribution_mode', { enum: EXPERTISE_CONTRIBUTION_MODES })
      .notNull()
      .default('derive'),

    addedByUserId: text('added_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),

    ...timestamps,
  },
  (t) => [
    check(
      'expertise_bindings_exactly_one_carrier',
      sql`(${t.agentId} IS NOT NULL)::int + (${t.projectId} IS NOT NULL)::int + (${t.boundWorkspaceId} IS NOT NULL)::int + (${t.boundUserId} IS NOT NULL)::int = 1`,
    ),
    uniqueIndex('expertise_bindings_agent_domain_unique')
      .on(t.agentId, t.domainId)
      .where(isNotNull(t.agentId)),
    uniqueIndex('expertise_bindings_project_domain_unique')
      .on(t.projectId, t.domainId)
      .where(isNotNull(t.projectId)),
    uniqueIndex('expertise_bindings_workspace_domain_unique')
      .on(t.boundWorkspaceId, t.domainId)
      .where(isNotNull(t.boundWorkspaceId)),
    uniqueIndex('expertise_bindings_user_domain_unique')
      .on(t.boundUserId, t.domainId)
      .where(isNotNull(t.boundUserId)),
    index('expertise_bindings_domain_idx').on(t.domainId),
    index('expertise_bindings_workspace_id_idx').on(t.workspaceId),
  ],
);

export type ExpertiseBindingItem = typeof expertiseBindings.$inferSelect;
export type NewExpertiseBinding = typeof expertiseBindings.$inferInsert;

// ============================================
// 3. expertise_lessons — P，心得
// ============================================

export const expertiseLessons = pgTable(
  'expertise_lessons',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    domainId: varchar255('domain_id')
      .notNull()
      .references(() => expertiseDomains.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    /** 人读的稳定编号 P-01 / C-02。洞察引用它，retired 的号不复用。 */
    code: varchar('code', { length: 20 }).notNull(),

    /**
     * rule 是中性判据 —— 既不是反模式也不是正例，而是一条启发式。
     * 它决定 sections 用哪套 key：
     *   bad  → wrong / why / breaks / correct
     *   good → good / works / dont
     *   rule → rule / why / how / limits
     */
    polarity: text('polarity', { enum: EXPERTISE_LESSON_POLARITIES }).notNull(),
    title: text('title').notNull(),
    /**
     * 四段结构化正文，有序。用 jsonb 而不是具名列：三种极性的字段名不同，
     * 具名列会有一多半永远是 null；对话改写按 key 定位只改其中一段。
     */
    sections: jsonb('sections').$type<ExpertiseLessonSection[]>().notNull(),

    layer: varchar255('layer'),
    tags: text('tags').array(),
    /** 锚不上经典（null）是弱信号 —— 按 BM-58 多半意味着还没想透，不是错误。 */
    canonAnchor: text('canon_anchor'),

    /** 教会我们这条的那次实践与那条命中。 */
    originRunId: uuid('origin_run_id'),
    originHitId: uuid('origin_hit_id'),

    /** 新学的默认进库，所以没有 candidate；守门靠事后淘汰而不是事前审批。 */
    status: text('status', { enum: EXPERTISE_LESSON_STATUSES }).notNull().default('active'),
    /** rejected 是回收站不是删除 —— 被过滤掉的条目里常有内核裹在实现外壳里。 */
    rejectedReason: text('rejected_reason'),
    salvagedFromId: uuid('salvaged_from_id').references((): AnyPgColumn => expertiseLessons.id, {
      onDelete: 'set null',
    }),
    retiredAt: timestamptz('retired_at'),

    /** 经验的终点：被编译成一条机器能跑的判据。心智模型层的永远是 not-compilable。 */
    compilability: text('compilability', { enum: EXPERTISE_COMPILABILITIES })
      .notNull()
      .default('compilable'),
    compiledCriterionId: uuid('compiled_criterion_id').references(() => verifyCriteria.id, {
      onDelete: 'set null',
    }),

    /**
     * hits 的冗余计数 —— 不是优化而是必需：hits 是唯一有规模风险的表，
     * 列表每次 count 会拖垮 L2。
     * hitCount 是「用上过多少次」（一次实践里同一条可用在多处），
     * hitRunCount 是「在多少个不同场景验证过」。梯队排序用前者，饱和判定用后者。
     */
    hitCount: integer('hit_count').notNull().default(0),
    hitRunCount: integer('hit_run_count').notNull().default(0),
    falsePositiveCount: integer('false_positive_count').notNull().default(0),
    lastHitAt: timestamptz('last_hit_at'),
    lastHitRunId: uuid('last_hit_run_id'),

    /**
     * 合并时指向被泛化掉的母规则，用于追溯「这条是从哪几条并出来的」。
     * 写入路径的三分支（instance / refine / new）里，refine 会填它。
     */
    generalizedFromIds: jsonb('generalized_from_ids').$type<string[]>(),
    /** 零命中的病因分类，决定该并回母规则还是保留（见 EXPERTISE_SPECIFICITIES）。 */
    specificity: text('specificity', { enum: EXPERTISE_SPECIFICITIES }),
    /** instance 判定挂上来的具体情形数 —— 就是 ✅❌ 例子的来源。 */
    exampleCount: integer('example_count').notNull().default(0),

    currentRevision: integer('current_revision').notNull().default(1),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('expertise_lessons_domain_code_unique').on(t.domainId, t.code),
    unique('expertise_lessons_id_domain_unique').on(t.id, t.domainId),
    index('expertise_lessons_domain_status_hits_idx').on(t.domainId, t.status, t.hitCount),
    index('expertise_lessons_domain_layer_idx').on(t.domainId, t.layer),
    index('expertise_lessons_compiled_criterion_idx').on(t.compiledCriterionId),
  ],
);

export type ExpertiseLessonItem = typeof expertiseLessons.$inferSelect;
export type NewExpertiseLesson = typeof expertiseLessons.$inferInsert;

// ============================================
// 4. expertise_lesson_revisions — 对话改写的版本链
// ============================================

/**
 * 「你说的条件成为它的例外」这件事的产物必须留痕，否则下次问「这条为什么加了
 * 这个限制」没人答得上来。feedback 存的是人当时说的原话 —— 它比改写结果更有价值。
 */
export const expertiseLessonRevisions = pgTable(
  'expertise_lesson_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => expertiseLessons.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),

    /** 该版本的完整正文快照。 */
    sections: jsonb('sections').$type<ExpertiseLessonSection[]>().notNull(),
    /** 触发这次改写的原话。 */
    feedback: text('feedback'),

    changedBy: text('changed_by', { enum: EXPERTISE_REVISION_ACTORS }).notNull(),
    /** 人说清楚了，还是合并时被泛化 —— 两者的价值和可信度不同。 */
    kind: text('kind', { enum: EXPERTISE_REVISION_KINDS }).notNull().default('user-feedback'),
    /** 改写前的标题，方便直接看出泛化了什么。 */
    prevTitle: text('prev_title'),
    changedByUserId: text('changed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    sourceRunId: uuid('source_run_id'),
    operationId: text('operation_id').references(() => agentOperations.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('expertise_lesson_revisions_lesson_revision_unique').on(t.lessonId, t.revision),
    index('expertise_lesson_revisions_lesson_idx').on(t.lessonId),
  ],
);

export type ExpertiseLessonRevisionItem = typeof expertiseLessonRevisions.$inferSelect;
export type NewExpertiseLessonRevision = typeof expertiseLessonRevisions.$inferInsert;

// ============================================
// 5. expertise_runs — 一次实践
// ============================================

/**
 * 一次实践 = 一次针对某个对象的完整判断过程。
 *
 * 边界不自己发明：直接复用 reflection 的时间窗口幂等键。reflection 本身就是
 * 「一个 agent 在一个 topic/scope 的时间窗口上的复盘」，正是这个定义。
 *
 * 刻意没有 operationId —— 一个 topic 上的反思天然跨多个 operation；
 * operation 归因下沉到 expertise_hits（每条证据来自哪次执行）。
 */
export const expertiseRuns = pgTable(
  'expertise_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    domainId: varchar255('domain_id')
      .notNull()
      .references(() => expertiseDomains.id, { onDelete: 'cascade' }),

    /** 曲线的 X 轴。写入时取该领域的 max+1。 */
    runIndex: integer('run_index').notNull(),
    /** 种子那次必然饱和 —— 一等公民字段，不能靠约定。 */
    isSeedRun: boolean('is_seed_run').notNull().default(false),

    // 归因（不是所有权）：这条曲线里有谁的贡献
    actorType: text('actor_type', { enum: EXPERTISE_ACTOR_TYPES }).notNull(),
    actorId: text('actor_id').notNull(),

    /** 沿用 acceptance 的 subject 约定，不自己发明一套。 */
    subjectType: text('subject_type', { enum: EXPERTISE_SUBJECT_TYPES }).notNull(),
    subjectId: text('subject_id').notNull(),

    windowStart: timestamptz('window_start'),
    windowEnd: timestamptz('window_end'),
    /** reflection 的窗口幂等键，保证同一个反思窗口不会重复建 run。 */
    reflectionKey: varchar255('reflection_key'),

    /** 「它学得最快的那几次你都在对话里」这条洞察靠它。 */
    hadHumanInLoop: boolean('had_human_in_loop').notNull().default(false),

    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /**
     * 写入路径三分支的计数。三者的比例是**枚举健康度的直接读数**：
     * instance 占绝大多数才是健康的规则库；new 居高不下说明在把案例当规则记。
     */
    instanceCount: integer('instance_count').notNull().default(0),
    refineCount: integer('refine_count').notNull().default(0),
    newCount: integer('new_count').notNull().default(0),

    startedAt: timestamptz('started_at').notNull().defaultNow(),
    completedAt: timestamptz('completed_at'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('expertise_runs_domain_run_index_unique').on(t.domainId, t.runIndex),
    unique('expertise_runs_id_domain_unique').on(t.id, t.domainId),
    uniqueIndex('expertise_runs_domain_reflection_key_unique')
      .on(t.domainId, t.reflectionKey)
      .where(isNotNull(t.reflectionKey)),
    index('expertise_runs_domain_started_idx').on(t.domainId, t.startedAt),
    index('expertise_runs_actor_idx').on(t.actorType, t.actorId),
    index('expertise_runs_subject_idx').on(t.subjectType, t.subjectId),
  ],
);

export type ExpertiseRunItem = typeof expertiseRuns.$inferSelect;
export type NewExpertiseRun = typeof expertiseRuns.$inferInsert;

// ============================================
// 6. expertise_hits — 命中
// ============================================

/**
 * 「这次用上了哪几条」。整个 L2 界面（梯队排序、死条目、✅❌ 例子、用进废退）
 * 都建立在这张表上。
 *
 * 注意「学到一条新的」**不是** hit —— 那是 lesson 的诞生，记在 lesson.originRunId。
 * 早期设计用 verdict + compliance 两个轴，是因为把这两件事混在了一张表里。
 *
 * 这是唯一有规模风险的表：一个专长 47 次 × 每次命中 30 条 = 1400 行，
 * 乘专长数乘租户数。所以 lesson 上的冗余计数是必需的；明细可归档，计数保留。
 */
export const expertiseHits = pgTable(
  'expertise_hits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id').notNull(),
    lessonId: uuid('lesson_id').notNull(),
    domainId: varchar255('domain_id')
      .notNull()
      .references(() => expertiseDomains.id, { onDelete: 'cascade' }),

    /** pass = 对象符合这条；violation = 违反（一条 finding）；false_positive = 这条用错了地方。 */
    outcome: text('outcome', { enum: EXPERTISE_HIT_OUTCOMES }).notNull(),

    /** 违反时的定位与说明。 */
    where: text('where'),
    note: text('note'),
    /** instance 判定挂的具体情形 —— 这条规则这次长什么样，就是 ✅❌ 例子。 */
    example: text('example'),
    severity: text('severity', { enum: EXPERTISE_HIT_SEVERITIES }),

    /** 证据接 verify_evidence，不退化成一句话。 */
    evidenceId: uuid('evidence_id').references(() => verifyEvidence.id, { onDelete: 'set null' }),
    operationId: text('operation_id').references(() => agentOperations.id, {
      onDelete: 'set null',
    }),

    /** 人否掉它 → 喂用进废退，让这条心得下次更保守。 */
    userDecision: text('user_decision', { enum: EXPERTISE_HIT_USER_DECISIONS }),
    userDecisionAt: timestamptz('user_decision_at'),

    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.runId, t.domainId],
      foreignColumns: [expertiseRuns.id, expertiseRuns.domainId],
      name: 'expertise_hits_run_domain_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.lessonId, t.domainId],
      foreignColumns: [expertiseLessons.id, expertiseLessons.domainId],
      name: 'expertise_hits_lesson_domain_fk',
    }).onDelete('cascade'),
    index('expertise_hits_lesson_created_idx').on(t.lessonId, t.createdAt),
    index('expertise_hits_run_idx').on(t.runId),
    index('expertise_hits_domain_outcome_idx').on(t.domainId, t.outcome),
    index('expertise_hits_operation_idx').on(t.operationId),
  ],
);

export type ExpertiseHitItem = typeof expertiseHits.$inferSelect;
export type NewExpertiseHit = typeof expertiseHits.$inferInsert;

// ============================================
// 7. expertise_domain_snapshots — 曲线的真相源
// ============================================

/**
 * 每次实践收尾写一行。一张表同时喂：L0 成熟度曲线、L1 柱线图、成熟度球、
 * 本月 delta、闲置判断、固化度、分层空洞。
 *
 * 计数与拟合刻意分离：
 *   - 计数部分由 run 收尾事件驱动写入，纯聚合、确定性、便宜
 *   - 拟合部分由 6 小时定时作业回填，是数值优化，失败模式完全不同
 * 于是有两种不同的「没有成熟度」，界面文案也不同：
 *   fitComputedAt IS NULL          → 还在算
 *   fitConfidence = 'insufficient' → 样本太少，还算不出来（不给假数字）
 */
export const expertiseDomainSnapshots = pgTable(
  'expertise_domain_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    domainId: varchar255('domain_id')
      .notNull()
      .references(() => expertiseDomains.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => expertiseRuns.id, { onDelete: 'set null' }),
    runIndex: integer('run_index').notNull(),

    // ---- 事件驱动写入 ----
    learnedTotal: integer('learned_total').notNull(),
    retiredTotal: integer('retired_total').notNull().default(0),
    /** = learnedTotal − retiredTotal。退休会让曲线掉头，那正是「能力在退」的可视化。 */
    activeCount: integer('active_count').notNull(),
    /** 固化度的分子：已编译成 verify criterion 的条数。 */
    compiledCount: integer('compiled_count').notNull().default(0),
    layerCounts: jsonb('layer_counts').$type<Record<string, number>>().notNull().default({}),

    // ---- 6 小时定时作业回填：P(n) = P∞·(1−e^(−n/τ)) ----
    /** 估计这个领域一共能学到多少条（渐近线）。 */
    pInf: numeric('p_inf', { mode: 'number' }),
    /** 学习时间常数，倒数即学习率。 */
    tau: numeric('tau', { mode: 'number' }),
    /** = activeCount / pInf，0..1。归一化后跨领域可比，不受练习次数绝对值影响。 */
    maturity: numeric('maturity', { mode: 'number' }),
    fitSampleSize: integer('fit_sample_size'),
    /**
     * 拟合优度。和 fitConfidence 不是一回事，两个都要留：r² 高只说明这条曲线贴合
     * 观测点，撞了 τ 上界的那 6 组回测 r² 同样漂亮 —— 贴合的是直线段。
     * 界面把它和 observedSpan 并排放，就是为了让「拟合得好」和「外推可信」分开被读。
     */
    fitR2: numeric('fit_r2', { mode: 'number' }),
    fitConfidence: text('fit_confidence', { enum: EXPERTISE_FIT_CONFIDENCES }),
    fitComputedAt: timestamptz('fit_computed_at'),
    /**
     * τ 撞上了搜索上界 = 拟合失败，此时 pInf / maturity 全是边界伪影。
     * 9 组回测里 6 组撞界，而旧版把它们全报成了 ok（有个「成熟度 93.6%」
     * 就是这么来的）。撞界必须一律降级。
     */
    tauPinned: boolean('tau_pinned').notNull().default(false),
    /**
     * = runIndex / τ。τ 是曲线弯折的尺度：没跨过一个时间常数，曲线还在直线段上，
     * 渐近线根本没被数据约束住，pInf 是**猜出来的而不是测出来的**。
     * < 1 时界面必须显式警告，不能拿它做外推。
     */
    observedSpan: numeric('observed_span', { mode: 'number' }),
    plateauKind: text('plateau_kind', { enum: EXPERTISE_PLATEAU_KINDS }),

    /**
     * 有界指标：分母固定，不依赖外推，拟合失败时它们仍然可信。
     *
     * 分层覆盖与 canon 覆盖是**两个独立的比率**，不能乘成笛卡尔积 —— 并非每个
     * (层, canon) 组合都有意义（entity_disambiguation 只在 entity_resolution
     * 层成立，配到 corroboration 层是个永远填不满的空格子）。
     */
    layerCoverage: numeric('layer_coverage', { mode: 'number' }),
    canonCoverage: numeric('canon_coverage', { mode: 'number' }),
    /** 有命中的规则 / 总规则。**枚举越多它越低 —— 天然的反枚举指标。** */
    activeRate: numeric('active_rate', { mode: 'number' }),

    capturedAt: timestamptz('captured_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.runId, t.domainId],
      foreignColumns: [expertiseRuns.id, expertiseRuns.domainId],
      name: 'expertise_domain_snapshots_run_domain_fk',
    }),
    uniqueIndex('expertise_domain_snapshots_domain_run_index_unique').on(t.domainId, t.runIndex),
    index('expertise_domain_snapshots_domain_captured_idx').on(t.domainId, t.capturedAt),
    index('expertise_domain_snapshots_pending_fit_idx')
      .on(t.domainId)
      .where(isNull(t.fitComputedAt)),
  ],
);

export type ExpertiseDomainSnapshotItem = typeof expertiseDomainSnapshots.$inferSelect;
export type NewExpertiseDomainSnapshot = typeof expertiseDomainSnapshots.$inferInsert;

// ============================================
// 8. expertise_insights — 跨多次实践才看得出的元模式
// ============================================

/**
 * 由定时分析作业产出，不是聚合查询能得到的：纠正记录的语义聚类、心得共现矩阵、
 * run 元数据关联、发现重叠度。
 *
 * 因为它是分析产物，一定会出错，所以 dismissed 是硬要求 —— 洞察必须能被否掉。
 * staleAfterRunIndex 让它随数据变化自动过期，避免陈旧结论一直挂在首屏。
 */
export const expertiseInsights = pgTable(
  'expertise_insights',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** 可为空：有些洞察是跨领域的。 */
    domainId: varchar255('domain_id').references(() => expertiseDomains.id, {
      onDelete: 'cascade',
    }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** 'repeated-mistake' | 'possible-duplicate' | 'learns-faster-with-human' | 'no-judgment-yet' … */
    kind: varchar255('kind').notNull(),
    headline: text('headline').notNull(),
    body: text('body').notNull(),
    actionLabel: text('action_label'),
    actionTarget: jsonb('action_target').$type<Record<string, unknown>>(),

    /** 支撑它的具体对象，点开要能走到。 */
    evidence: jsonb('evidence').$type<ExpertiseInsightEvidenceRef[]>().notNull().default([]),
    confidence: real('confidence'),

    status: text('status', { enum: EXPERTISE_INSIGHT_STATUSES }).notNull().default('active'),
    dismissReason: text('dismiss_reason'),
    /** 超过这个实践序号后视为过期。 */
    staleAfterRunIndex: integer('stale_after_run_index'),

    generatedByOperationId: text('generated_by_operation_id').references(() => agentOperations.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('expertise_insights_domain_status_idx').on(t.domainId, t.status),
    index('expertise_insights_user_status_idx').on(t.userId, t.status),
    index('expertise_insights_workspace_idx').on(t.workspaceId),
  ],
);

export type ExpertiseInsightItem = typeof expertiseInsights.$inferSelect;
export type NewExpertiseInsight = typeof expertiseInsights.$inferInsert;
