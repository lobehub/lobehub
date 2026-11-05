import { GOAL_BRIEF_TRIGGER, GOAL_CLARIFICATION_OPTION } from '@lobechat/const/goal';
import type { BriefAction, BriefGoalMetadata, GoalDecisionOption, GoalItem } from '@lobechat/types';
import { coordinatorGateReason } from '@lobechat/utils/goalCopy';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { BriefModel } from '@/database/models/brief';
import { acceptances, briefs } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

/** Option ids the coordinator writes; anything else is the main Agent's or the planner's. */
const COORDINATOR_OPTION_LABELS: Record<string, string> = {
  fail: 'Fail goal',
  retire: 'Retire work',
  retry: 'Retry work',
  [GOAL_CLARIFICATION_OPTION.assume]: 'Go with the assumption',
};

/** How the coordinator words a machine gate's question (see `openFailureDecisionLocked`). */
const MACHINE_GATE_TAIL = /Fix it, then retry or retire this task node\?$/;

const SUMMARY_LIMIT = 600;

const DECIDED_ACCEPTANCE_STATUSES = new Set<string>(['accepted', 'closed', 'rejected']);

const signOffFor = (acceptanceId: string) =>
  sql`${briefs.metadata} -> 'goal' ->> 'signOffAcceptanceId' = ${acceptanceId}`;

const decisionFor = (decisionId: string) =>
  sql`${briefs.metadata} -> 'goal' ->> 'decisionId' = ${decisionId}`;

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
  /** A held batch release: answered in this review report, not by a one-click action. */
  reviewAcceptanceId?: string;
}

/**
 * The goal's half of the inbox. A gate the coordinator opens and the sign-off
 * a finished goal waits for are written as briefs, so the person hears about them wherever they are instead of only
 * when they happen to open the goal page.
 *
 * Gate writes are best-effort: a brief is the notification, never the state —
 * the gate exists whether or not its brief could be written, and the goal page
 * still asks it. The sign-off is the exception: once the goal is achieved no
 * other surface asks for it, so `openSignOff` throws and its caller retries.
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
      const reason = coordinatorGateReason(input.question) ?? input.question;
      // The machine gate's retry means "I fixed the setup", not "try again".
      const machine = MACHINE_GATE_TAIL.test(input.question);
      const label = (option: GoalDecisionOption) =>
        machine && option.id === 'retry'
          ? 'I fixed it — retry'
          : (COORDINATOR_OPTION_LABELS[option.id] ?? option.label);
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
          label: 'Open goal',
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
          ...(input.reviewAcceptanceId ? { reviewAcceptanceId: input.reviewAcceptanceId } : {}),
          ...(recommended ? { recommendedAction: recommended.id } : {}),
        },
        priority: 'urgent',
        summary: clip(recommended ? `${reason}\n\nRecommended: ${label(recommended)}` : reason),
        title: `Goal "${goal.title}" needs your decision`,
        type: 'decision',
      });
    });

  /**
   * A clarification round is one form on the goal page, so it is one brief —
   * answering question by question from the inbox would re-plan on half of them.
   */
  openClarification = async (goal: GoalItem, decisionIds: string[], questions: string[]) =>
    this.safely('openClarification', async () => {
      await this.create(goal, {
        actions: [
          {
            key: 'answer',
            label: 'Answer',
            type: 'link',
            url: goalPagePath(goal),
          },
        ],
        // The round settles with its last question; any one id keeps the
        // brief tied to it, and the first is the one asked first.
        metadata: { decisionId: decisionIds[0], kind: 'decision' },
        priority: 'urgent',
        summary: clip(questions.map((q, i) => `${i + 1}. ${q}`).join('\n')),
        title: `Goal "${goal.title}" has questions before it starts`,
        type: 'decision',
      });
    });

  /**
   * The goal-level acceptance passed: the owner signs the result off or sends it back.
   *
   * The acceptance row is locked while the brief is written, so a decision that
   * lands meanwhile either is seen here (and nothing is asked) or waits for this
   * brief to exist and then settles it — never an open ask for a decided result.
   * Throws on failure: the caller opens it before the goal turns terminal, so
   * the next tick retries.
   */
  openSignOff = async (goal: GoalItem, acceptanceId: string): Promise<void> => {
    await this.db.transaction(async (tx) => {
      const [acceptance] = await tx
        .select({ status: acceptances.status })
        .from(acceptances)
        .where(and(eq(acceptances.id, acceptanceId), eq(acceptances.userId, this.userId)))
        .for('update');
      // Already decided — accepted, sent back or closed — nothing is left
      // to sign, and the card could never be answered.
      if (!acceptance || DECIDED_ACCEPTANCE_STATUSES.has(acceptance.status)) return;

      const briefModel = new BriefModel(tx, this.userId, this.workspaceId);
      const existing = await tx
        .select({ id: briefs.id })
        .from(briefs)
        .where(and(briefModel.ownership(), isNull(briefs.resolvedAt), signOffFor(acceptanceId)))
        .limit(1);
      if (existing.length > 0) return;

      await this.create(
        goal,
        {
          actions: [
            { key: 'signOff', label: 'Sign off', type: 'resolve' },
            {
              key: 'requestChanges',
              label: 'Request changes',
              type: 'comment',
            },
            {
              key: 'openGoal',
              label: 'Open goal',
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
          summary:
            'Goal-level acceptance passed. Sign it off to close the goal, or request changes to send it back.',
          title: `Goal "${goal.title}" is done. Sign it off`,
          type: 'decision',
        },
        briefModel,
      );
    });
  };

  /** The sign-off was given or refused somewhere else — the acceptance itself, the goal page. */
  settleSignOff = async (acceptanceId: string, action: string, comment?: string) =>
    this.safely('settleSignOff', async () => {
      await this.db
        .update(briefs)
        .set({ resolvedAction: action, resolvedAt: new Date(), resolvedComment: comment ?? null })
        .where(
          and(this.briefModel.ownership(), isNull(briefs.resolvedAt), signOffFor(acceptanceId)),
        );
    });

  /** A gate was answered somewhere else — its review report, the goal page. */
  settleDecision = async (decisionId: string, action: string, comment?: string) =>
    this.safely('settleDecision', async () => {
      await this.db
        .update(briefs)
        .set({ resolvedAction: action, resolvedAt: new Date(), resolvedComment: comment ?? null })
        .where(
          and(this.briefModel.ownership(), isNull(briefs.resolvedAt), decisionFor(decisionId)),
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
          this.briefModel.ownership(),
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
    briefModel = this.briefModel,
  ) =>
    briefModel.create({
      actions: input.actions,
      agentId: goal.agentId,
      metadata: { goal: { ...input.metadata, goalId: goal.id, goalTitle: goal.title } },
      priority: input.priority,
      summary: input.summary,
      title: input.title,
      trigger: GOAL_BRIEF_TRIGGER,
      type: input.type,
    });

  private safely = async (label: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      console.error(`[GoalBriefService.${label}]`, error);
    }
  };
}
