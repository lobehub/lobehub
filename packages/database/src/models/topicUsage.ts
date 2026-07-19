import { and, eq, type SQL, sql } from 'drizzle-orm';

import { topics } from '../schemas';
import type { Transaction } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

interface ToolUsageEntry {
  calls: number;
  errors: number;
  name: string;
  totalTimeMs: number;
}

interface ToolCostEntry {
  calls: number;
  currency: string;
  name: string;
  totalCost: number;
}

interface HumanInteractionUsage {
  approvalRequests: number;
  promptRequests: number;
  selectRequests: number;
  totalWaitingTimeMs: number;
}

/** Tool / human-interaction rollup derived from the topic's operation rows. */
interface OperationUsageRollup {
  /** True when any operation contributed a non-zero tool / human-interaction stat. */
  hasData: boolean;
  humanInteraction: HumanInteractionUsage;
  toolsCost: { byTool: ToolCostEntry[]; total: number };
  toolsUsage: { byTool: ToolUsageEntry[]; totalCalls: number; totalTimeMs: number };
}

/**
 * ModelUsage numeric fields summed per (provider, model) to build the
 * `cost.llm.byModel[].usage` breakdown. Mirrors ModelUsageSchema in
 * `@lobechat/types` (message/common/metadata.ts) — keep in sync if it changes.
 */
const USAGE_FIELDS = [
  'totalInputTokens',
  'totalOutputTokens',
  'totalTokens',
  'inputTextTokens',
  'inputImageTokens',
  'inputAudioTokens',
  'inputVideoTokens',
  'inputCitationTokens',
  'inputToolTokens',
  'inputCachedTokens',
  'inputCacheMissTokens',
  'inputWriteCacheTokens',
  'inputCachedTextTokens',
  'inputCachedImageTokens',
  'inputCachedAudioTokens',
  'inputCachedVideoTokens',
  'outputTextTokens',
  'outputImageTokens',
  'outputAudioTokens',
  'outputReasoningTokens',
  'acceptedPredictionTokens',
  'rejectedPredictionTokens',
] as const;

const num = (v: unknown): number => (v == null ? 0 : Number(v));

/**
 * Aggregate tool + human-interaction usage and tool cost from the topic's
 * `agent_operations` rows. This data only exists on operation rows — assistant
 * messages carry LLM usage but know nothing about tool execution.
 *
 * Reads the `usage` / `cost` jsonb blobs, which are contractually each op's OWN
 * accumulator (child spend is folded into the scalar columns only — see the
 * comment in `CompletionLifecycle.persistCompletion`). Sub-agent children and
 * group members are separate rows carrying the same `topic_id`, so summing the
 * blobs counts every op's spend exactly once, with no parent/child double count.
 * Park/resume cycles are safe too: `waiting_for_async_tool` resumes overwrite
 * the same row, and a `waiting_for_human` resume runs under a NEW operationId
 * with a fresh accumulator.
 */
const aggregateOperationUsage = async (
  trx: Transaction,
  ownership: SQL,
  topicId: string,
): Promise<OperationUsageRollup> => {
  const { rows } = await trx.execute(sql`
    SELECT
      usage->'tools' AS "toolsUsage",
      usage->'humanInteraction' AS "humanInteraction",
      cost->'tools' AS "toolsCost"
    FROM agent_operations
    WHERE topic_id = ${topicId}
      AND ${ownership}
      AND (usage IS NOT NULL OR cost IS NOT NULL)
  `);

  const usageByTool = new Map<string, ToolUsageEntry>();
  const costByTool = new Map<string, ToolCostEntry>();
  let totalCalls = 0;
  let totalTimeMs = 0;
  let costTotal = 0;
  const humanInteraction: HumanInteractionUsage = {
    approvalRequests: 0,
    promptRequests: 0,
    selectRequests: 0,
    totalWaitingTimeMs: 0,
  };

  for (const row of rows as Array<Record<string, any>>) {
    const toolsUsage = row.toolsUsage;
    if (toolsUsage) {
      totalCalls += num(toolsUsage.totalCalls);
      totalTimeMs += num(toolsUsage.totalTimeMs);
      if (Array.isArray(toolsUsage.byTool)) {
        for (const entry of toolsUsage.byTool) {
          if (!entry?.name) continue;
          let merged = usageByTool.get(entry.name);
          if (!merged) {
            merged = { calls: 0, errors: 0, name: entry.name, totalTimeMs: 0 };
            usageByTool.set(entry.name, merged);
          }
          merged.calls += num(entry.calls);
          merged.errors += num(entry.errors);
          merged.totalTimeMs += num(entry.totalTimeMs);
        }
      }
    }

    const hi = row.humanInteraction;
    if (hi) {
      humanInteraction.approvalRequests += num(hi.approvalRequests);
      humanInteraction.promptRequests += num(hi.promptRequests);
      humanInteraction.selectRequests += num(hi.selectRequests);
      humanInteraction.totalWaitingTimeMs += num(hi.totalWaitingTimeMs);
    }

    const toolsCost = row.toolsCost;
    if (toolsCost) {
      costTotal += num(toolsCost.total);
      if (Array.isArray(toolsCost.byTool)) {
        for (const entry of toolsCost.byTool) {
          if (!entry?.name) continue;
          let merged = costByTool.get(entry.name);
          if (!merged) {
            merged = { calls: 0, currency: 'USD', name: entry.name, totalCost: 0 };
            costByTool.set(entry.name, merged);
          }
          merged.calls += num(entry.calls);
          merged.totalCost += num(entry.totalCost);
        }
      }
    }
  }

  const byName = <T extends { name: string }>(map: Map<string, T>) =>
    [...map.values()].sort((a, b) => a.name.localeCompare(b.name));

  const hasData =
    totalCalls > 0 ||
    totalTimeMs > 0 ||
    costTotal > 0 ||
    usageByTool.size > 0 ||
    costByTool.size > 0 ||
    Object.values(humanInteraction).some((v) => v > 0);

  return {
    hasData,
    humanInteraction,
    toolsCost: { byTool: byName(costByTool), total: costTotal },
    toolsUsage: { byTool: byName(usageByTool), totalCalls, totalTimeMs },
  };
};

/**
 * Recompute a topic's denormalized usage/cost rollup.
 *
 * Pure derived projection over two sources:
 *   1. LLM tokens/cost: SUM over the topic's `role='assistant'` messages
 *      (thread messages count too — they also carry `topic_id`), preferring the
 *      dedicated `usage` column and falling back to legacy `metadata.usage`.
 *   2. Tool + human-interaction usage and tool cost: SUM over the topic's
 *      `agent_operations` usage/cost blobs (see {@link aggregateOperationUsage})
 *      — this data never lands on messages, so operations are its only source.
 *
 * The stored shape mirrors `agent_operations`:
 *   - scalar columns : total_input_tokens / total_output_tokens / total_tokens / total_cost
 *   - `usage` jsonb  : flat aggregate { llm: { apiCalls, processingTimeMs, tokens }, tools, humanInteraction }
 *   - `cost`  jsonb  : { total, currency, llm: { total, currency, byModel[] }, tools } — or NULL when nothing reported cost
 *   - model/provider : the dominant model by total_tokens
 *   `total_cost` / `cost.total` include tool cost on top of LLM cost.
 *
 * Idempotent and non-cumulative: when neither source has measurable usage, the
 * columns are reset to NULL ("not measured"). Note the deletion asymmetry: LLM
 * stats follow the live messages (deletions / regenerations drop out), while
 * tool stats follow the operation audit rows, which survive message deletion —
 * that spend really happened, so it stays counted as long as the ops exist.
 *
 * Concurrency: the owned topic row is locked (`FOR UPDATE`) BEFORE the
 * aggregate reads. Without it, two concurrent recomputes can interleave so
 * that an older aggregate snapshot overwrites a newer rollup (lost update),
 * undercounting until the next trigger. Writers already serialized on the row
 * lock at the final UPDATE — taking it up front makes the read+write atomic
 * per topic (blocked waiters re-read after the holder commits; READ COMMITTED
 * gives each new statement a fresh snapshot) without changing lock order.
 *
 * Keep activity timestamps stable: recency is derived from `messages.updated_at`,
 * so this projection update must not bump `topics.updated_at` / `accessed_at`.
 * Drizzle `$onUpdate` is bypassed by explicitly assigning the columns to
 * themselves.
 *
 * TODO: This still updates the `topics` row for usage/cost/token rollups. Under
 * high-concurrency assistant finalization for the same topic, recomputes
 * serialize on the topic row lock. Consider moving this projection to a
 * debounced/asynchronous rollup or a separate per-topic usage table.
 */
export const recomputeTopicUsage = async (
  trx: Transaction,
  userId: string,
  topicId: string,
  workspaceId?: string,
): Promise<void> => {
  // Serialize concurrent recomputes for the same topic before any aggregate
  // read (see the concurrency note above). Every caller touches messages /
  // agent_operations before topics, so taking the topic lock last in that
  // order introduces no new deadlock path. Also short-circuits when the topic
  // row is missing or not owned — the final UPDATE could never match anyway.
  const [locked] = await trx
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.id, topicId), buildWorkspaceWhere({ userId, workspaceId }, topics)))
    .for('update');

  if (!locked) return;

  // Reads prefer the dedicated `usage` column, falling back to legacy
  // `metadata->'usage'` for rows written before the migration.
  const fieldSelects = USAGE_FIELDS.map(
    (f) => `sum((COALESCE(usage, metadata->'usage')->>'${f}')::numeric) AS "${f}"`,
  ).join(',\n      ');

  // Workspace-aware ownership predicate for the raw aggregates (messages and
  // agent_operations both carry user_id/workspace_id): in team mode rows are
  // scoped by workspace_id (creator user_id is not part of the filter); in
  // personal mode by user_id with workspace_id IS NULL.
  const rowOwnership = workspaceId
    ? sql`workspace_id = ${workspaceId}`
    : sql`user_id = ${userId} AND workspace_id IS NULL`;

  const { rows } = await trx.execute(sql`
    SELECT
      provider,
      model,
      count(*)::int AS "msgCount",
      sum((COALESCE(usage, metadata->'usage')->>'cost')::numeric) AS "cost",
      sum((metadata->'performance'->>'duration')::numeric) AS "durationMs",
      ${sql.raw(fieldSelects)}
    FROM messages
    WHERE topic_id = ${topicId}
      AND ${rowOwnership}
      AND role = 'assistant'
      AND (usage IS NOT NULL OR metadata ? 'usage')
    GROUP BY provider, model
  `);

  const groups = rows as Array<Record<string, unknown>>;

  const ops = await aggregateOperationUsage(trx, rowOwnership, topicId);

  // No measurable usage left in either source → reset to NULL so the columns
  // reflect reality.
  if (groups.length === 0 && !ops.hasData) {
    await trx
      .update(topics)
      .set({
        accessedAt: topics.accessedAt,
        cost: null,
        model: null,
        provider: null,
        totalCost: null,
        totalInputTokens: null,
        totalOutputTokens: null,
        totalTokens: null,
        updatedAt: topics.updatedAt,
        usage: null,
      })
      .where(and(eq(topics.id, topicId), buildWorkspaceWhere({ userId, workspaceId }, topics)));
    return;
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let hasCost = false;
  let apiCalls = 0;
  let processingTimeMs = 0;
  const byModel: Array<Record<string, unknown>> = [];
  let primary: { model: string | null; provider: string | null; tokens: number } | null = null;

  for (const g of groups) {
    const rowTotalTokens = num(g.totalTokens);
    totalInputTokens += num(g.totalInputTokens);
    totalOutputTokens += num(g.totalOutputTokens);
    totalTokens += rowTotalTokens;
    apiCalls += num(g.msgCount);
    processingTimeMs += num(g.durationMs);

    const rowCost = g.cost == null ? null : Number(g.cost);
    if (rowCost != null) {
      totalCost += rowCost;
      hasCost = true;
    }

    // Dominant model = largest token volume.
    if (!primary || rowTotalTokens > primary.tokens) {
      primary = {
        model: (g.model as string) ?? null,
        provider: (g.provider as string) ?? null,
        tokens: rowTotalTokens,
      };
    }

    // cost.llm.byModel mirrors the operation shape: cost-bearing models only,
    // each carrying its merged ModelUsage breakdown.
    if (rowCost != null) {
      const usageObj: Record<string, number> = {};
      for (const f of USAGE_FIELDS) if (g[f] != null) usageObj[f] = Number(g[f]);
      usageObj.cost = rowCost;

      byModel.push({
        id: `${(g.provider as string) ?? 'unknown'}/${(g.model as string) ?? 'unknown'}`,
        model: (g.model as string) ?? null,
        provider: (g.provider as string) ?? null,
        totalCost: rowCost,
        usage: usageObj,
      });
    }
  }

  const usage = {
    humanInteraction: ops.humanInteraction,
    llm: {
      apiCalls,
      processingTimeMs,
      tokens: { input: totalInputTokens, output: totalOutputTokens, total: totalTokens },
    },
    tools: ops.toolsUsage,
  };

  // Tool cost rides on top of the LLM cost: `total_cost` / `cost.total` carry
  // the whole topic spend, while `cost.llm.total` stays LLM-only.
  const toolCostTotal = ops.toolsCost.total;
  const hasAnyCost = hasCost || toolCostTotal > 0;

  const cost = hasAnyCost
    ? {
        currency: 'USD',
        llm: { byModel, currency: 'USD', total: totalCost },
        total: totalCost + toolCostTotal,
        tools: { byTool: ops.toolsCost.byTool, currency: 'USD', total: toolCostTotal },
      }
    : null;

  // Token scalar columns stay message-derived: with no assistant usage rows the
  // tokens are "not measured" (NULL), even when operations contributed tool stats.
  const hasLlmGroups = groups.length > 0;

  await trx
    .update(topics)
    .set({
      accessedAt: topics.accessedAt,
      cost,
      model: primary?.model ?? null,
      provider: primary?.provider ?? null,
      totalCost: hasAnyCost ? totalCost + toolCostTotal : null,
      totalInputTokens: hasLlmGroups ? totalInputTokens : null,
      totalOutputTokens: hasLlmGroups ? totalOutputTokens : null,
      totalTokens: hasLlmGroups ? totalTokens : null,
      updatedAt: topics.updatedAt,
      usage,
    })
    .where(and(eq(topics.id, topicId), buildWorkspaceWhere({ userId, workspaceId }, topics)));
};
