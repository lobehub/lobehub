import { GOAL_BRIEF_TRIGGER, GOAL_CLARIFICATION_OPTION } from '@lobechat/const/goal';
import type { BriefAction, BriefGoalMetadata, GoalDecisionOption, GoalItem } from '@lobechat/types';
import { coordinatorGateReason, coordinatorReasonCopy } from '@lobechat/utils/goalCopy';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { BriefModel } from '@/database/models/brief';
import { briefs } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { translation } from '@/libs/i18n/serverTranslation';
import { SystemAgentService } from '@/server/services/systemAgent';

/** Option ids the coordinator writes; anything else is the main Agent's or the planner's. */
const COORDINATOR_OPTION_KEYS: Record<string, string> = {
  fail: 'goalProcess.gate.option.fail',
  retire: 'goalProcess.gate.option.retire',
  retry: 'goalProcess.gate.option.retry',
  [GOAL_CLARIFICATION_OPTION.assume]: 'goalProcess.gate.option.assume',
};

/** How the coordinator words a machine gate's question (see `openFailureDecisionLocked`). */
const MACHINE_GATE_TAIL = /Fix it, then retry or retire this task node\?$/;

const SUMMARY_LIMIT = 600;

const clip = (text: string, limit = SUMMARY_LIMIT) =>
  text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;

/** Root-relative so the inbox routes it inside the SPA, workspace prefix included. */
export const goalPagePath = (goal: Pick<GoalItem, 'agentId' | 'id'>) =>
  goal.agentId ? `/agent/${goal.agentId}/goal/${goal.id}` : `/goal/${goal.id}`;

export interface GoalSignOffRequest {
  acceptanceId: string;
  agentId: string | null;
  briefId: string;
  createdAt: Date;
  goalId: string;
  goalTitle: string;
}

interface DecisionInput {
  decisionId: string;
  options?: GoalDecisionOption[] | null;
  question: string;
  recommendedOptionId?: string | null;
}

/**
 * The goal's half of the inbox. A gate the coordinator opens and the sign-off
 * a finished goal waits for are written as briefs, so the person hears about them wherever they are instead of only
 * when they happen to open the goal page.
 *
 * Every write is best-effort: a brief is the notification, never the state —
 * the gate exists whether or not its brief could be written.
 */
export class GoalBriefService {
  private briefModel: BriefModel;
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.briefModel = new BriefModel(db, userId, workspaceId);
  }

  /** A failure gate, or a question the main Agent escalated with its own options. */
  openDecision = async (goal: GoalItem, input: DecisionInput) =>
    this.safely('openDecision', async () => {
      const { t } = await this.chatCopy();
      const { t: tHome } = await this.homeCopy();
      const reason = coordinatorGateReason(input.question) ?? input.question;
      const reasonCopy = coordinatorReasonCopy(reason);
      const localizedReason = reasonCopy ? t(reasonCopy.key, reasonCopy.params) : reason;
      // The machine gate's retry means "I fixed the setup", not "try again".
      const machine = MACHINE_GATE_TAIL.test(input.question);
      const label = (option: GoalDecisionOption) => {
        const key =
          machine && option.id === 'retry'
            ? 'goalProcess.gate.option.fixedRetry'
            : COORDINATOR_OPTION_KEYS[option.id];
        return key ? t(key) : option.label;
      };
      const recommended = input.options?.find((o) => o.id === input.recommendedOptionId);

      const actions: BriefAction[] = [
        ...(input.options ?? []).map((option): BriefAction => ({
          key: option.id,
          label: label(option),
          // The planner's free answer is the note itself.
          type: option.id === GOAL_CLARIFICATION_OPTION.answer ? 'comment' : 'resolve',
        })),
        {
          key: 'openGoal',
          label: tHome('brief.action.openGoal'),
          type: 'link',
          url: goalPagePath(goal),
        },
      ];
      // The inbox card leads with its first non-comment action; keep the
      // recommended answer there so the obvious click is the advised one.
      if (recommended) {
        actions.sort((a, b) => Number(b.key === recommended.id) - Number(a.key === recommended.id));
      }

      await this.create(goal, {
        actions,
        metadata: {
          decisionId: input.decisionId,
          kind: 'decision',
          ...(recommended ? { recommendedAction: recommended.id } : {}),
        },
        priority: 'urgent',
        summary: clip(
          recommended
            ? `${localizedReason}\n\n${tHome('brief.goal.recommended', { option: label(recommended) })}`
            : localizedReason,
        ),
        title: tHome('brief.goal.decision.title', { goal: goal.title }),
        type: 'decision',
      });
    });

  /**
   * A clarification round is one form on the goal page, so it is one brief —
   * answering question by question from the inbox would re-plan on half of them.
   */
  openClarification = async (goal: GoalItem, decisionIds: string[], questions: string[]) =>
    this.safely('openClarification', async () => {
      const { t: tHome } = await this.homeCopy();
      await this.create(goal, {
        actions: [
          {
            key: 'answer',
            label: tHome('brief.action.answer'),
            type: 'link',
            url: goalPagePath(goal),
          },
        ],
        // The round settles with its last question; any one id keeps the
        // brief tied to it, and the first is the one asked first.
        metadata: { decisionId: decisionIds[0], kind: 'decision' },
        priority: 'urgent',
        summary: clip(questions.map((q, i) => `${i + 1}. ${q}`).join('\n')),
        title: tHome('brief.goal.clarify.title', { goal: goal.title }),
        type: 'decision',
      });
    });

  /** The goal-level acceptance passed: the owner signs the result off or sends it back. */
  openSignOff = async (goal: GoalItem, acceptanceId: string) =>
    this.safely('openSignOff', async () => {
      const existing = await this.db
        .select({ id: briefs.id })
        .from(briefs)
        .where(
          and(
            isNull(briefs.resolvedAt),
            sql`${briefs.metadata} -> 'goal' ->> 'signOffAcceptanceId' = ${acceptanceId}`,
          ),
        )
        .limit(1);
      if (existing.length > 0) return;
      const { t: tHome } = await this.homeCopy();
      await this.create(goal, {
        actions: [
          { key: 'signOff', label: tHome('brief.action.signOff'), type: 'resolve' },
          { key: 'requestChanges', label: tHome('brief.action.requestChanges'), type: 'comment' },
          {
            key: 'openGoal',
            label: tHome('brief.action.openGoal'),
            type: 'link',
            url: goalPagePath(goal),
          },
        ],
        metadata: {
          kind: 'signOff',
          recommendedAction: 'signOff',
          signOffAcceptanceId: acceptanceId,
        },
        priority: 'normal',
        summary: tHome('brief.goal.signOff.summary'),
        title: tHome('brief.goal.signOff.title', { goal: goal.title }),
        type: 'decision',
      });
    });

  /** The sign-off was given or refused somewhere else — the acceptance itself, the goal page. */
  settleSignOff = async (acceptanceId: string, action: string, comment?: string) =>
    this.safely('settleSignOff', async () => {
      await this.db
        .update(briefs)
        .set({ resolvedAction: action, resolvedAt: new Date(), resolvedComment: comment ?? null })
        .where(
          and(
            eq(briefs.userId, this.userId),
            isNull(briefs.resolvedAt),
            sql`${briefs.metadata} -> 'goal' ->> 'signOffAcceptanceId' = ${acceptanceId}`,
          ),
        );
    });

  /** Goals waiting on the person's sign-off — the island asks for these too. */
  listOpenSignOffs = async (): Promise<GoalSignOffRequest[]> => {
    const rows = await this.db
      .select({
        agentId: briefs.agentId,
        briefId: briefs.id,
        createdAt: briefs.createdAt,
        metadata: briefs.metadata,
      })
      .from(briefs)
      .where(
        and(
          eq(briefs.userId, this.userId),
          eq(briefs.trigger, GOAL_BRIEF_TRIGGER),
          isNull(briefs.resolvedAt),
          sql`${briefs.metadata} -> 'goal' ->> 'kind' = 'signOff'`,
        ),
      )
      .orderBy(briefs.createdAt);
    return rows.flatMap((row) => {
      const goal = row.metadata?.goal;
      if (!goal?.signOffAcceptanceId) return [];
      return [
        {
          acceptanceId: goal.signOffAcceptanceId,
          agentId: row.agentId,
          briefId: row.briefId,
          createdAt: row.createdAt,
          goalId: goal.goalId,
          goalTitle: goal.goalTitle,
        },
      ];
    });
  };

  private create = async (
    goal: GoalItem,
    input: {
      actions: BriefAction[];
      metadata: Omit<BriefGoalMetadata, 'goalId' | 'goalTitle'>;
      priority: 'info' | 'normal' | 'urgent';
      summary: string;
      title: string;
      type: 'decision';
    },
  ) =>
    this.briefModel.create({
      actions: input.actions,
      agentId: goal.agentId,
      metadata: { goal: { ...input.metadata, goalId: goal.id, goalTitle: goal.title } },
      priority: input.priority,
      summary: input.summary,
      title: input.title,
      trigger: GOAL_BRIEF_TRIGGER,
      type: input.type,
    });

  private locale?: Promise<string>;

  private readLocale = () => {
    this.locale ??= new SystemAgentService(this.db, this.userId, this.workspaceId)
      .getUserLocale()
      .catch(() => 'en-US');
    return this.locale;
  };

  private chatCopy = async () => translation('chat', await this.readLocale());

  private homeCopy = async () => translation('home', await this.readLocale());

  private safely = async (label: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      console.error(`[GoalBriefService.${label}]`, error);
    }
  };
}
