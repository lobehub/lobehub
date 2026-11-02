import { and, asc, count, desc, eq, gte, isNull, lt, notInArray, sql } from 'drizzle-orm';

import {
  agents,
  messagePlugins,
  messages,
  signalDecisionLabels,
  signalDecisions,
  topics,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { notTrashed } from '../../utils/softDelete';

/** `topics.trigger` of a topic an external bot platform (Discord, Slack, …) started. */
export const BOT_TOPIC_TRIGGER = 'bot';

/** Identifier and api name of the `lobe-agent` vent tool call; the call row is the vent record. */
const VENT_IDENTIFIER = 'lobe-agent';
const VENT_API_NAME = 'vent';

/** `signal_decision_labels.source` of the owner's own mark on a wake decision. */
const OWNER_LABEL_SOURCE = 'user';

const parseAggregateTimestamp = (value: Date | string) =>
  value instanceof Date ? value : new Date(value);

/** One review window: UTC instants of the user's local review day, end exclusive. */
export interface BotRetroWindow {
  windowEnd: Date;
  windowStart: Date;
}

export interface ListBotRetroAgentsOptions extends BotRetroWindow {
  limit: number;
}

export interface ListBotRetroEvidenceOptions extends BotRetroWindow {
  agentId: string;
  limit: number;
}

export interface BotRetroFailedToolCall {
  apiName: string | null;
  errorSummary: string | null;
  identifier: string | null;
}

export interface BotRetroTopicRow {
  /** Assistant replies the bot posted in this topic during the window. */
  assistantMessageCount: number;
  /** Message-level errors (provider failures, aborted runs) during the window. */
  failedMessages: string[];
  failedToolCalls: BotRetroFailedToolCall[];
  lastActivityAt: Date;
  messageCount: number;
  /** Bot platform from `topics.metadata.bot.platform`, e.g. `discord`. */
  platform: string | null;
  summary: string;
  title: string | null;
  topicId: string;
}

export interface BotRetroVentRow {
  /** Raw vent arguments (category, severity, summary, details) as the agent sent them. */
  arguments: string | null;
  createdAt: Date;
  messageId: string;
  /** Tool result state; `recorded: false` means the runtime rejected the vent. */
  state: Record<string, unknown> | null;
  topicId: string | null;
}

export interface BotRetroWakeMarkRow {
  createdAt: Date;
  decisionId: string;
  finalReason: string | null;
  /** The owner's latest mark, e.g. `false_wake`, `missed_wake`, `bad_reply`. */
  label: string;
  outcome: string;
  reason: string | null;
  topicId: string | null;
}

/**
 * Reads what a bot-connected agent went through on one day, for its nightly retro.
 *
 * Scope is the user's personal space, matching the Agent Signal nightly review: workspace
 * agents are not reviewed. Everything is bounded by the caller's `limit`.
 */
export class AgentBotRetroModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /** Reads the title and description the retro prompt introduces the agent with. */
  getAgentMeta = async (agentId: string) => {
    const [row] = await this.db
      .select({ description: agents.description, title: agents.title })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.userId, this.userId)))
      .limit(1);

    return row;
  };

  /**
   * Lists agents that worked in at least one bot topic during the window, busiest first.
   *
   * Bot topics are reused per platform thread, so activity is read from message time rather
   * than topic creation time.
   */
  listBotActiveAgents = async (options: ListBotRetroAgentsOptions): Promise<string[]> => {
    const rows = await this.db
      .select({ agentId: topics.agentId, messageCount: count(messages.id) })
      .from(messages)
      .innerJoin(topics, eq(topics.id, messages.topicId))
      .innerJoin(
        agents,
        and(
          eq(agents.id, topics.agentId),
          isNull(agents.workspaceId),
          notTrashed(agents.isDeleted),
        ),
      )
      .where(
        and(
          eq(messages.userId, this.userId),
          isNull(messages.workspaceId),
          notTrashed(messages.isDeleted),
          eq(topics.trigger, BOT_TOPIC_TRIGGER),
          notTrashed(topics.isDeleted),
          gte(messages.createdAt, options.windowStart),
          lt(messages.createdAt, options.windowEnd),
        ),
      )
      .groupBy(topics.agentId)
      .orderBy(desc(count(messages.id)), asc(topics.agentId))
      .limit(options.limit);

    return rows.flatMap((row) => (row.agentId ? [row.agentId] : []));
  };

  /** Lists the agent's bot topics active in the window with their failures, latest first. */
  listBotTopics = (options: ListBotRetroEvidenceOptions): Promise<BotRetroTopicRow[]> => {
    return this.db
      .select({
        assistantMessageCount:
          sql<number>`COUNT(${messages.id}) FILTER (WHERE ${messages.role} = 'assistant')`.mapWith(
            Number,
          ),
        failedMessages: sql<string[]>`
          COALESCE(
            array_agg(DISTINCT left(${messages.error}::text, 300))
              FILTER (WHERE ${messages.error} IS NOT NULL),
            ARRAY[]::text[]
          )
        `,
        failedToolCalls: sql<BotRetroFailedToolCall[]>`
          COALESCE(
            jsonb_agg(
              DISTINCT jsonb_build_object(
                'apiName', ${messagePlugins.apiName},
                'errorSummary', left(${messagePlugins.error}::text, 300),
                'identifier', ${messagePlugins.identifier}
              )
            ) FILTER (WHERE ${messagePlugins.error} IS NOT NULL),
            '[]'::jsonb
          )
        `,
        lastActivityAt: sql<Date>`MAX(${messages.createdAt})`.mapWith(parseAggregateTimestamp),
        messageCount: count(messages.id),
        platform: sql<string | null>`${topics.metadata}->'bot'->>'platform'`,
        summary: sql<string>`COALESCE(${topics.historySummary}, ${topics.description}, '')`,
        title: topics.title,
        topicId: topics.id,
      })
      .from(messages)
      .innerJoin(topics, eq(topics.id, messages.topicId))
      .leftJoin(messagePlugins, eq(messagePlugins.id, messages.id))
      .where(
        and(
          eq(messages.userId, this.userId),
          isNull(messages.workspaceId),
          notTrashed(messages.isDeleted),
          eq(topics.agentId, options.agentId),
          eq(topics.trigger, BOT_TOPIC_TRIGGER),
          notTrashed(topics.isDeleted),
          gte(messages.createdAt, options.windowStart),
          lt(messages.createdAt, options.windowEnd),
        ),
      )
      .groupBy(topics.id, topics.title, topics.historySummary, topics.description, topics.metadata)
      .orderBy(desc(sql`MAX(${messages.createdAt})`))
      .limit(options.limit);
  };

  /**
   * Lists the agent's vent calls during the window, in any topic: a platform problem the bot
   * hit is worth knowing about wherever it was reported.
   */
  listVents = (options: ListBotRetroEvidenceOptions): Promise<BotRetroVentRow[]> => {
    return this.db
      .select({
        arguments: messagePlugins.arguments,
        createdAt: messages.createdAt,
        messageId: messages.id,
        state: sql<Record<string, unknown> | null>`${messagePlugins.state}`,
        topicId: messages.topicId,
      })
      .from(messagePlugins)
      .innerJoin(messages, eq(messages.id, messagePlugins.id))
      .leftJoin(topics, eq(topics.id, messages.topicId))
      .where(
        and(
          eq(messagePlugins.userId, this.userId),
          eq(messagePlugins.identifier, VENT_IDENTIFIER),
          eq(messagePlugins.apiName, VENT_API_NAME),
          isNull(messages.workspaceId),
          notTrashed(messages.isDeleted),
          eq(sql`COALESCE(${messages.agentId}, ${topics.agentId})`, options.agentId),
          gte(messages.createdAt, options.windowStart),
          lt(messages.createdAt, options.windowEnd),
        ),
      )
      .orderBy(asc(messages.createdAt))
      .limit(options.limit);
  };

  /**
   * Lists wake decisions of the window the owner marked as wrong (`false_wake`, `missed_wake`,
   * `bad_reply`, …).
   *
   * Only the owner's latest mark counts; a mark withdrawn with `cleared` or confirmed `correct`
   * drops the decision out.
   */
  listOwnerWakeMarks = async (
    options: ListBotRetroEvidenceOptions,
  ): Promise<BotRetroWakeMarkRow[]> => {
    const latestMarks = this.db
      .selectDistinctOn([signalDecisionLabels.decisionId], {
        decisionId: signalDecisionLabels.decisionId,
        label: signalDecisionLabels.label,
        reason: sql<string | null>`COALESCE(
          ${signalDecisionLabels.metadata}->>'rationale',
          ${signalDecisionLabels.metadata}->>'reason'
        )`.as('reason'),
      })
      .from(signalDecisionLabels)
      .where(eq(signalDecisionLabels.source, OWNER_LABEL_SOURCE))
      .orderBy(signalDecisionLabels.decisionId, desc(signalDecisionLabels.createdAt))
      .as('bot_retro_owner_marks');

    const rows = await this.db
      .select({
        createdAt: signalDecisions.createdAt,
        decisionId: signalDecisions.id,
        finalReason: signalDecisions.finalReason,
        label: latestMarks.label,
        outcome: signalDecisions.outcome,
        reason: latestMarks.reason,
        topicId: signalDecisions.topicId,
      })
      .from(signalDecisions)
      .innerJoin(latestMarks, eq(latestMarks.decisionId, signalDecisions.id))
      .where(
        and(
          eq(signalDecisions.userId, this.userId),
          eq(signalDecisions.agentId, options.agentId),
          gte(signalDecisions.createdAt, options.windowStart),
          lt(signalDecisions.createdAt, options.windowEnd),
          notInArray(latestMarks.label, ['correct', 'cleared']),
        ),
      )
      .orderBy(asc(signalDecisions.createdAt))
      .limit(options.limit);

    return rows;
  };
}
