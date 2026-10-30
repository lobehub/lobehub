import {
  BOT_WAKE_USER_LABEL_SOURCE,
  BOT_WAKE_USER_LABELS,
  BOT_WAKE_USER_LABELS_BY_OUTCOME,
  type BotWakeDecisionPage,
  type BotWakeSummary,
  type BotWakeUserLabel,
  type BotWakeUserMark,
  SIGNAL_DECISION_LABEL_CLEARED,
  SIGNAL_DECISION_OUTCOMES,
  type SignalDecisionLabel,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import {
  type CurrentDecisionLabel,
  SCOPE_READ_DEFAULT_DAYS,
  SCOPE_READ_MAX_LIMIT,
  SignalDecisionModel,
} from '@/database/models/signalDecision';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { BOT_WAKE_FOLLOWUP_REASONS } from '@/server/services/bot/BotMessageRouter/wakeDecision';
import { NO_REPLY_LABEL_SOURCE } from '@/server/services/bot/noReplyLabel';
import { pickWakeJudgeScore } from '@/server/services/bot/wake/judgeScore';

import {
  agentBotProviderProcedure,
  agentBotProviderProcedureWrite,
} from './_helpers/agentBotProviderProcedure';

const BOT_NOT_FOUND_MESSAGE = 'Bot integration not found';
const DECISION_NOT_FOUND_MESSAGE = 'Wake record not found';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The agent's own silence labels that mean "this wake did not need an answer". */
const SILENCE_LABELS = new Set<SignalDecisionLabel>(['false_wake', 'dup_wake']);

interface BotScopeCtx {
  agentBotProviderModel: Pick<AgentBotProviderModel, 'findById'>;
  serverDB: LobeChatDatabase;
}

/**
 * The bot the caller may see, and its decisions' scope. Found through the same scoped lookup as the
 * settings page, so a bot outside the caller's user / workspace reads as missing. Decisions are
 * stored under the bot owner's user id, which is not the caller's for a teammate's bot.
 */
const resolveBotScope = async (ctx: BotScopeCtx, botId: string) => {
  const bot = await ctx.agentBotProviderModel.findById(botId);
  if (!bot) throw new TRPCError({ code: 'NOT_FOUND', message: BOT_NOT_FOUND_MESSAGE });

  return {
    // The bot's own workspace, not the caller's: a teammate may read a bot its workspace owns, and
    // the scope read must match the `workspace_id` the wake pipeline recorded the decisions under.
    decisions: new SignalDecisionModel(ctx.serverDB, bot.userId, bot.workspaceId ?? undefined),
    scopeKey: `${bot.platform}:${bot.applicationId}`,
  };
};

const pickLabel = (labels: CurrentDecisionLabel[], source: string) =>
  labels.find((label) => label.source === source);

const cursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});

export const agentBotWakeRouter = router({
  /**
   * One bot's wake decisions, newest first, from the last {@link SCOPE_READ_DEFAULT_DAYS} days:
   * the message preview, what the router did and why, the model score behind it (`judge`), the
   * agent's own silence label and the owner's current mark. The raw verdicts stay on the server.
   */
  listWakeDecisions: agentBotProviderProcedure
    .input(
      z.object({
        botId: z.string(),
        cursor: cursorSchema.optional(),
        followupOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(SCOPE_READ_MAX_LIMIT).optional(),
        outcome: z.enum(SIGNAL_DECISION_OUTCOMES).optional(),
        unmarkedOnly: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }): Promise<BotWakeDecisionPage> => {
      const { decisions, scopeKey } = await resolveBotScope(ctx, input.botId);
      const followups = new Set(BOT_WAKE_FOLLOWUP_REASONS);

      const page = await decisions.listByScope({
        cursor: input.cursor,
        finalReasons: input.followupOnly ? BOT_WAKE_FOLLOWUP_REASONS : undefined,
        labeled: input.unmarkedOnly ? { by: BOT_WAKE_USER_LABEL_SOURCE, has: false } : undefined,
        limit: input.limit,
        outcome: input.outcome,
        scopeKey,
      });

      return {
        items: page.items.map(({ labels, verdicts, ...item }) => {
          const agent = pickLabel(labels, NO_REPLY_LABEL_SOURCE);
          const user = pickLabel(labels, BOT_WAKE_USER_LABEL_SOURCE);

          return {
            ...item,
            agentLabel: agent ? { label: agent.label, reason: agent.metadata.reason } : null,
            followup: !!item.finalReason && followups.has(item.finalReason),
            judge: pickWakeJudgeScore(verdicts, item.finalReason) ?? null,
            userLabel: user
              ? { createdAt: user.createdAt, label: user.label, note: user.metadata.rationale }
              : null,
          };
        }),
        nextCursor: page.nextCursor,
      };
    }),

  /** Counts for the last {@link SCOPE_READ_DEFAULT_DAYS} days of one bot's wake decisions. */
  getWakeSummary: agentBotProviderProcedure
    .input(z.object({ botId: z.string() }))
    .query(async ({ ctx, input }): Promise<BotWakeSummary> => {
      const { decisions, scopeKey } = await resolveBotScope(ctx, input.botId);

      const summary = await decisions.summaryByScope({
        followupReasons: BOT_WAKE_FOLLOWUP_REASONS,
        labelSources: [BOT_WAKE_USER_LABEL_SOURCE, NO_REPLY_LABEL_SOURCE],
        scopeKey,
        since: new Date(Date.now() - SCOPE_READ_DEFAULT_DAYS * DAY_MS),
      });

      const agentLabels = summary.labels[NO_REPLY_LABEL_SOURCE] ?? {};
      const userLabels = summary.labels[BOT_WAKE_USER_LABEL_SOURCE] ?? {};

      return {
        days: SCOPE_READ_DEFAULT_DAYS,
        defer: summary.defer,
        followupWakes: summary.followupWakes,
        marked: Object.values(userLabels).reduce((sum, count) => sum + (count ?? 0), 0),
        markedByLabel: userLabels,
        silenced: Object.entries(agentLabels).reduce(
          (sum, [label, count]) =>
            SILENCE_LABELS.has(label as SignalDecisionLabel) ? sum + (count ?? 0) : sum,
          0,
        ),
        skip: summary.skip,
        total: summary.total,
        wake: summary.wake,
      };
    }),

  /**
   * The owner marks whether a decision was right, or takes the mark back (`label: null`). Labels are
   * append-only, so a changed mind is a new row and the latest one is the mark; taking it back
   * appends `cleared`, which reads as no mark. Returns the mark now in force.
   */
  labelWakeDecision: agentBotProviderProcedureWrite
    .input(
      z.object({
        botId: z.string(),
        decisionId: z.string().uuid(),
        label: z.enum(BOT_WAKE_USER_LABELS).nullable(),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<BotWakeUserMark> => {
      const { decisions, scopeKey } = await resolveBotScope(ctx, input.botId);

      // The decision must be this bot's: same owner (the model is scoped to it) and same channel.
      const decision = await decisions.findById(input.decisionId);
      if (!decision || decision.scopeKey !== scopeKey) {
        throw new TRPCError({ code: 'NOT_FOUND', message: DECISION_NOT_FOUND_MESSAGE });
      }

      if (input.label === null) {
        const latest = (await decisions.listLabels(decision.id)).find(
          (row) => row.source === BOT_WAKE_USER_LABEL_SOURCE,
        );
        // Nothing to take back: no row, so the history only records real changes of mind.
        if (!latest || latest.label === SIGNAL_DECISION_LABEL_CLEARED) return null;

        const row = await decisions.addLabel(decision.id, {
          actor: ctx.userId,
          label: SIGNAL_DECISION_LABEL_CLEARED,
          metadata: { surface: 'bot_settings' },
          source: BOT_WAKE_USER_LABEL_SOURCE,
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: DECISION_NOT_FOUND_MESSAGE });

        return null;
      }

      const allowed: readonly BotWakeUserLabel[] =
        BOT_WAKE_USER_LABELS_BY_OUTCOME[decision.outcome] ?? [];
      if (!allowed.includes(input.label)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `A ${decision.outcome} decision cannot be marked ${input.label}`,
        });
      }

      const row = await decisions.addLabel(decision.id, {
        actor: ctx.userId,
        label: input.label,
        metadata: { surface: 'bot_settings', ...(input.note ? { rationale: input.note } : {}) },
        source: BOT_WAKE_USER_LABEL_SOURCE,
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: DECISION_NOT_FOUND_MESSAGE });

      return {
        createdAt: row.createdAt,
        label: row.label as BotWakeUserLabel,
        note: row.metadata.rationale,
      };
    }),
});
