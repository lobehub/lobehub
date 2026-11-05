'use client';

import { GOAL_BATCH_BREAK_OPTION, GOAL_BATCH_RELEASE_OPTION } from '@lobechat/const/goal';
import type { GoalDecisionOption } from '@lobechat/types';
import {
  Avatar,
  Center,
  createStaticStyles,
  cssVar,
  Flexbox,
  Icon,
  Text,
  toast,
} from '@lobehub/ui';
import { MonitorCog } from 'lucide-react';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import ClarificationQuestions, {
  type ClarificationAnswer,
} from '@/features/ClarificationQuestions';

import {
  type CoordinatorGateKind,
  coordinatorGateKind,
  coordinatorGateReason,
  gateOptionLabelKey,
  localizedCoordinatorReason,
} from '../ProcessControl/coordinatorCopy';
import {
  gateAnswerProblem,
  type GoalGateCategory,
  type GoalGateDecision,
  toGateAnswer,
  toGateQuestion,
} from './mapping';

export { type GoalGateCategory, goalGateCategory, type GoalGateDecision } from './mapping';

type GateCategory = Exclude<GoalGateCategory, 'clarify'>;

interface GoalDecisionAskerProps {
  /** The agent the goal answers to — the one asking, unless the system is. */
  agentId?: string | null;
  category: GateCategory;
  /** Trailing context on the asker line, e.g. which goal (the island). */
  extra?: ReactNode;
  size?: number;
  /** Overrides what the asker wants, for a host asking something other than a gate. */
  subtitle?: string;
}

/**
 * Who is asking. A gate is the goal's agent turning to its owner, so it leads
 * with that agent the way an AskUserQuestion card leads with the agent that
 * called it; a machine gate has no one behind it but the system, and says so
 * with its own mark instead of borrowing the agent's face.
 */
export const GoalDecisionAsker = ({
  agentId,
  category,
  extra,
  size = 28,
  subtitle,
}: GoalDecisionAskerProps) => {
  const { t } = useTranslation('chat');
  const meta = useAgentDisplayMeta(agentId);
  const machine = category === 'machine';

  return (
    <Flexbox horizontal align={'center'} gap={10} style={{ minWidth: 0 }}>
      {machine ? (
        // The run environment's glyph on a light approval-blue tile, in the
        // avatar's place: the system asks, not an agent.
        <Center
          flex={'none'}
          style={{
            background: cssVar.colorInfoBg,
            borderRadius: cssVar.borderRadius,
            color: cssVar.colorInfo,
            height: size,
            width: size,
          }}
        >
          <Icon icon={MonitorCog} size={size * 0.58} />
        </Center>
      ) : (
        <Avatar
          avatar={meta?.avatar}
          background={meta?.backgroundColor}
          shape={'circle'}
          size={size}
          style={{ flex: 'none' }}
          title={meta?.title}
        />
      )}
      <Flexbox horizontal align={'baseline'} gap={10} style={{ minWidth: 0 }}>
        {/* The asker's name, then what it wants, in the same voice: one line,
            set apart by space rather than by a dimmer grey. */}
        <Text ellipsis style={{ flex: 'none', maxWidth: 240 }} weight={500}>
          {machine ? t('goalProcess.decision.system') : meta?.title}
        </Text>
        <Text ellipsis>{subtitle ?? t(`goalProcess.decision.asks.${category}` as const)}</Text>
        {extra}
      </Flexbox>
    </Flexbox>
  );
};

/** The coordinator's own answers, in the reader's words, and what each one does. */
export const useGateOptionCopy = () => {
  const { i18n, t } = useTranslation('chat');
  return useMemo(() => {
    const alsoRetiresList = (option: GoalDecisionOption) =>
      option.alsoRetires?.length
        ? new Intl.ListFormat(i18n.language).format(
            option.alsoRetires.map(({ title }) =>
              t('goalProcess.decision.effect.quotedTask', { title }),
            ),
          )
        : undefined;
    return {
      /**
       * What an option the main Agent wrote also does to dependent tasks. Its
       * own description is the Agent's words; the cascade is the coordinator's,
       * so it is added here rather than trusted to the Agent to mention.
       */
      cascade: (option: GoalDecisionOption) => {
        const tasks = alsoRetiresList(option);
        return tasks ? t('goalProcess.decision.effect.alsoRetires', { tasks }) : undefined;
      },
      describe: (
        option: GoalDecisionOption,
        category: GoalGateCategory,
        gateKind?: CoordinatorGateKind,
      ) => {
        const terminalAcceptance = category === 'goalAcceptance';
        switch (option.id) {
          case 'retry': {
            if (category === 'machine') return t('goalProcess.decision.effect.fixedRetry');
            return terminalAcceptance
              ? t('goalProcess.decision.effect.retryAcceptance')
              : t('goalProcess.decision.effect.retry');
          }
          case 'retire': {
            if (terminalAcceptance) return t('goalProcess.decision.effect.abandonAcceptance');
            // Dependents leave with it, or they would wait forever on it.
            const tasks = alsoRetiresList(option);
            return tasks
              ? t('goalProcess.decision.effect.retireWithDependents', { tasks })
              : t('goalProcess.decision.effect.retire');
          }
          case 'fail': {
            return t('goalProcess.decision.effect.fail');
          }
          // A batch pattern break keeps only its option ids on the payload; the
          // consequences are written here, in the reader's language, rather than
          // persisted as English copy the server cannot translate.
          case GOAL_BATCH_BREAK_OPTION.revise: {
            return gateKind === 'batchRelease'
              ? t('goalProcess.decision.effect.sendBackBatch')
              : t('goalProcess.decision.effect.reviseBatch');
          }
          case GOAL_BATCH_BREAK_OPTION.newClass: {
            return t('goalProcess.decision.effect.newClassBatch');
          }
          case GOAL_BATCH_RELEASE_OPTION.release: {
            return t('goalProcess.decision.effect.releaseBatch');
          }
          default: {
            return undefined;
          }
        }
      },
      label: (
        option: GoalDecisionOption,
        category: GoalGateCategory,
        gateKind?: CoordinatorGateKind,
      ) => {
        const key = gateOptionLabelKey(option, category === 'machine' ? 'fixSetup' : gateKind);
        return key ? t(key as any) : option.label;
      },
    };
  }, [i18n.language, t]);
};

const contextStyles = createStaticStyles(({ css, cssVar }) => ({
  block: css`
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 8px 16px;

    padding-block: 12px;
    padding-inline: 14px;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  description: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    margin-block-start: 2px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  label: css`
    font-size: 13px;
    line-height: 22px;
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    cursor: pointer;
    font-weight: 500;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
}));

/**
 * What the owner needs before reading the question: the Task that stopped —
 * its name and what it was asked to do — and, in one line, what they are
 * being asked to decide.
 */
const GateContext = ({
  summary,
  task,
}: {
  summary?: string;
  task?: { description?: string | null; onOpen?: () => void; title: string };
}) => {
  const { t } = useTranslation('chat');
  return (
    <div className={contextStyles.block}>
      {task && (
        <>
          <span className={contextStyles.label}>{t('goalProcess.decision.context.task')}</span>
          <div style={{ lineHeight: '22px', minWidth: 0 }}>
            <span className={contextStyles.title} onClick={task.onOpen}>
              {task.title}
            </span>
            {task.description && (
              <div className={contextStyles.description}>{task.description}</div>
            )}
          </div>
        </>
      )}
      {summary && (
        <>
          <span className={contextStyles.label}>{t('goalProcess.decision.context.decision')}</span>
          <span style={{ lineHeight: '22px' }}>{summary}</span>
        </>
      )}
    </div>
  );
};

/**
 * The one-sentence account a gate opens with: what stopped, and why it is the
 * owner's call. Built from the category and the Task it is about.
 */
export const useGateSummary = () => {
  const { t } = useTranslation('chat');
  return (category: GateCategory, taskTitle?: string | null) =>
    t(`goalProcess.decision.summary.${category}` as const, {
      task: taskTitle || t('goalProcess.decision.summary.thisTask'),
    });
};

export interface GoalDecisionCaseProps {
  /** Portal the submit footer into a host-owned footer (the island pins it). */
  actionsPortalTarget?: HTMLElement | null;
  /** The agent the goal answers to; it is the one asking. */
  agentId?: string | null;
  /**
   * What the gate stands on beyond its question — the main Agent's diagnosis,
   * the coordinator's reason when the question is the Agent's own.
   */
  basis?: string | null;
  /** Read-only: the case is shown, the answer form is not. */
  canAnswer?: boolean;
  category: GateCategory;
  decision: GoalGateDecision;
  /** Proof the owner may want before answering: attempts, acceptance, the run. */
  evidence?: ReactNode;
  /**
   * Quiet links on the answer row's leading edge (open the task, its
   * attempts), across from the submit button — the way a brief carries its
   * "View run" — instead of a row of their own above the question.
   */
  footer?: ReactNode;
  /** The host already says who is asking (the island's own header). */
  hideAsker?: boolean;
  onDecide: (optionId: string, resolution?: string) => Promise<unknown>;
  /** What the gate is about — the Task it stopped, linked to its run. */
  subject?: ReactNode;
  /**
   * What the owner is being asked to decide, in one sentence: which work
   * stopped and why it came to them. Leads the case beside the Task it is
   * about; the question alone read as a riddle.
   */
  summary?: string;
  /** The Task the gate stopped: its title and what it was asked to do. */
  task?: { description?: string | null; onOpen?: () => void; title: string };
}

/**
 * One gate, asked the way the product asks every question of its own: the
 * AskUserQuestion form, with the answers' consequences written out and the
 * advised one marked. What kind of question it is leads, so a system
 * problem never reads like a judgment call; the evidence sits between the
 * question's framing and its answers.
 *
 * Shared by the goal page, the approval island and the result page, so a
 * gate reads and answers the same wherever it is met.
 */
const GoalDecisionCase = ({
  actionsPortalTarget,
  agentId,
  hideAsker,
  basis,
  canAnswer = true,
  category,
  decision,
  evidence,
  footer,
  onDecide,
  subject,
  summary,
  task,
}: GoalDecisionCaseProps) => {
  const { t } = useTranslation('chat');
  const optionCopy = useGateOptionCopy();

  // The coordinator's English reason renders in the reader's language when
  // recognized; an Agent's question is already in the goal's language.
  const rawReason = coordinatorGateReason(decision.question) ?? decision.question;
  // Every blocker of a compound batch reason, not just a single one.
  const questionText = localizedCoordinatorReason(rawReason, t as any);
  const basisText = basis && basis.trim() !== rawReason.trim() ? basis.trim() : undefined;

  const questions = useMemo(() => {
    const gateKind = coordinatorGateKind(decision);
    return [
      toGateQuestion(decision, {
        basis: basisText,
        cascade: optionCopy.cascade,
        describe: (option) => optionCopy.describe(option, category, gateKind),
        label: (option) => optionCopy.label(option, category, gateKind),
        question: questionText,
      }),
    ];
  }, [basisText, category, decision, optionCopy, questionText]);

  // A batch break revises the recipe with the correction written here; without
  // one the "revision" would re-run the plan that just failed.
  const batchBreak = !!decision.options?.some(
    (option) => option.id === GOAL_BATCH_BREAK_OPTION.revise,
  );

  const handleSubmit = useCallback(
    async (answers: ClarificationAnswer[]) => {
      const answer = toGateAnswer(decision, answers);
      if (!answer) return false;
      if (gateAnswerProblem(answer) === 'correctionRequired') {
        toast.error(t('goalProcess.gate.batchCorrectionRequired'));
        return false;
      }
      await onDecide(answer.optionId, answer.resolution?.trim() || undefined);
    },
    [decision, onDecide, t],
  );

  // With links to lay beside it, the card owns the submit row: links on the
  // left, the form's submit portalled in on the right.
  const [ownFooter, setOwnFooter] = useState<HTMLDivElement | null>(null);
  const ownsFooter = !!footer && !actionsPortalTarget;

  return (
    <Flexbox gap={12}>
      {!hideAsker && <GoalDecisionAsker agentId={agentId} category={category} />}
      {(task || summary) && <GateContext summary={summary} task={task} />}
      {subject}
      {canAnswer ? (
        <ClarificationQuestions
          actionsPortalTarget={ownsFooter ? ownFooter : actionsPortalTarget}
          draftKey={`goal-gate:${decision.id}`}
          key={decision.id}
          questions={questions}
          submitLabel={t('goalProcess.decision.submit')}
          supplementPlaceholder={t(
            batchBreak
              ? 'goalProcess.gate.batchCorrectionPlaceholder'
              : 'goalProcess.gate.notePlaceholder',
          )}
          onSubmit={handleSubmit}
        />
      ) : (
        <Flexbox gap={4}>
          <Text weight={500}>{questionText}</Text>
          {basisText && <Text type={'secondary'}>{basisText}</Text>}
        </Flexbox>
      )}
      {(ownsFooter || (!canAnswer && footer)) && (
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Flexbox horizontal align={'center'} gap={4} style={{ flex: 'none' }}>
            {footer}
          </Flexbox>
          {canAnswer && <div ref={setOwnFooter} style={{ flex: 1, minWidth: 0 }} />}
        </Flexbox>
      )}
      {evidence}
    </Flexbox>
  );
};

export default GoalDecisionCase;
