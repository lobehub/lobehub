import { and, eq, sql } from 'drizzle-orm';

import { topics } from '../schemas';
import type { Transaction } from '../type';

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
 * Recompute a topic's denormalized usage/cost rollup from its assistant messages.
 *
 * Pure derived projection: SUM over the topic's `role='assistant'` messages
 * (thread messages count too — they also carry `topic_id`), reading the
 * canonical `metadata.usage`. The stored shape mirrors `agent_operations`:
 *   - scalar columns : total_input_tokens / total_output_tokens / total_tokens / total_cost
 *   - `usage` jsonb  : flat aggregate { llm: { apiCalls, processingTimeMs, tokens }, tools, humanInteraction }
 *   - `cost`  jsonb  : { total, currency, llm: { total, currency, byModel[] }, tools } — or NULL when no model reported cost
 *   - model/provider : the dominant model by total_tokens
 *
 * Idempotent and non-cumulative: when the topic has no measurable assistant
 * usage (e.g. after deletions), the columns are reset to NULL ("not measured"),
 * so deletes / regenerations are reflected correctly.
 *
 * NOTE: this writes through drizzle, whose `topics.updatedAt` has `$onUpdate`,
 * so calling it bumps `updated_at`. That's intended for the live path (the
 * topic is active anyway). The historical backfill must NOT use this — it runs
 * its own raw-SQL aggregate that leaves `updated_at` untouched.
 */
export const recomputeTopicUsage = async (
  trx: Transaction,
  userId: string,
  topicId: string,
): Promise<void> => {
  const fieldSelects = USAGE_FIELDS.map(
    (f) => `sum((metadata->'usage'->>'${f}')::numeric) AS "${f}"`,
  ).join(',\n      ');

  const { rows } = await trx.execute(sql`
    SELECT
      provider,
      model,
      count(*)::int AS "msgCount",
      sum((metadata->'usage'->>'cost')::numeric) AS "cost",
      sum((metadata->'performance'->>'duration')::numeric) AS "durationMs",
      ${sql.raw(fieldSelects)}
    FROM messages
    WHERE topic_id = ${topicId}
      AND user_id = ${userId}
      AND role = 'assistant'
      AND metadata ? 'usage'
    GROUP BY provider, model
  `);

  const groups = rows as Array<Record<string, unknown>>;

  // No measurable usage left → reset to NULL so the column reflects reality.
  if (groups.length === 0) {
    await trx
      .update(topics)
      .set({
        cost: null,
        model: null,
        provider: null,
        totalCost: null,
        totalInputTokens: null,
        totalOutputTokens: null,
        totalTokens: null,
        usage: null,
      })
      .where(and(eq(topics.id, topicId), eq(topics.userId, userId)));
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
    humanInteraction: {
      approvalRequests: 0,
      promptRequests: 0,
      selectRequests: 0,
      totalWaitingTimeMs: 0,
    },
    llm: {
      apiCalls,
      processingTimeMs,
      tokens: { input: totalInputTokens, output: totalOutputTokens, total: totalTokens },
    },
    // Tool / human-interaction accounting isn't reconstructable from assistant
    // messages alone; left as a zero skeleton to keep the shape aligned with operations.
    tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
  };

  const cost = hasCost
    ? {
        currency: 'USD',
        llm: { byModel, currency: 'USD', total: totalCost },
        total: totalCost,
        tools: { byTool: [], currency: 'USD', total: 0 },
      }
    : null;

  await trx
    .update(topics)
    .set({
      cost,
      model: primary?.model ?? null,
      provider: primary?.provider ?? null,
      totalCost: hasCost ? totalCost : null,
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      usage,
    })
    .where(and(eq(topics.id, topicId), eq(topics.userId, userId)));
};
