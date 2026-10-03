'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowRight, CircleSlash, Flag, MessageCircleQuestion, XCircle } from 'lucide-react';
import { type ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActivityTime } from '@/hooks/useActivityTime';

import { createGoalModal } from '../CreateGoalModal';
import {
  coordinatorGateKind,
  coordinatorGateReason,
  coordinatorReasonCopy,
  gateTitleKey,
} from './coordinatorCopy';
import { pickFinalDeliverable } from './goalAcceptanceReport';
import type { GoalGraphView } from './goalGraphViewModel';
import {
  buildAbandonedNodes,
  buildUserDecisions,
  type CriterionOutcome,
  findFinalAcceptanceView,
  type UserDecisionView,
} from './goalResultState';

/**
 * 你做过的决定 and 没有完成 / 下一步 — what the owner already shaped, and what
 * is still open. Both read only recorded data: decisions from
 * `goal_node_decisions`, unmet criteria from the latest acceptance round,
 * dropped tasks from the graph; the report's next steps are appended when a
 * wrap-up storyline exists, never required.
 */

const styles = createStaticStyles(({ css }) => ({
  item: css`
    padding-block: 10px;

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  time: css`
    flex: none;
    min-width: 60px;
    text-align: end;
  `,
}));

export const SectionTitle = ({ children, extra }: { children: ReactNode; extra?: ReactNode }) => (
  <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
    <Text fontSize={16} weight={600}>
      {children}
    </Text>
    {extra}
  </Flexbox>
);

/** A group inside a section — one step below `SectionTitle`, same row grammar. */
export const GroupLabel = ({ children, extra }: { children: ReactNode; extra?: ReactNode }) => (
  <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
    <Text fontSize={13} type={'secondary'} weight={600}>
      {children}
    </Text>
    {extra}
  </Flexbox>
);

const DecisionTime = ({ at }: { at: Date }) => {
  const { text, title } = useActivityTime(at);
  return (
    <Text className={styles.time} fontSize={12} title={title} type={'secondary'}>
      {text}
    </Text>
  );
};

/**
 * A decision in the owner's language. Coordinator gates are stored as English
 * templates ("… Retry or retire this task node?") with stable option ids; a
 * recognized gate reads as its localized title, the task it was about and the
 * localized reason. Any other decision keeps the wording it was asked in.
 */
const useDecisionCopy = (graph: GoalGraphView) => {
  const { t } = useTranslation('chat');

  return (view: UserDecisionView) => {
    const { decision } = view;
    const kind = coordinatorGateKind(decision);
    if (!kind) return { choice: view.choice, question: view.question };

    const subjectId = graph.byId[decision.nodeId]?.gateSubjectId;
    const subject = subjectId ? graph.byId[subjectId]?.node.title : undefined;
    const rawReason = coordinatorGateReason(decision.question);
    const reasonCopy = coordinatorReasonCopy(rawReason);
    const optionId = decision.resolvedOptionId;
    const choice =
      optionId === 'retry' || optionId === 'retire' || optionId === 'fail'
        ? t(`goalProcess.gate.option.${optionId}`)
        : view.choice;

    return {
      choice,
      detail: reasonCopy ? t(reasonCopy.key as any, reasonCopy.params) : rawReason,
      question: subject
        ? `${t(gateTitleKey(kind) as any)} · ${subject}`
        : t(gateTitleKey(kind) as any),
    };
  };
};

const DecisionItem = ({
  copy,
  view,
}: {
  copy: { choice?: string; detail?: string; question: string };
  view: UserDecisionView;
}) => (
  <Flexbox horizontal className={styles.item} gap={12}>
    <Icon
      color={cssVar.colorTextTertiary}
      icon={MessageCircleQuestion}
      size={16}
      style={{ flex: 'none', marginBlockStart: 2 }}
    />
    <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
      <Text style={{ wordBreak: 'break-word' }}>{copy.question}</Text>
      {copy.detail && (
        <Text fontSize={13} style={{ wordBreak: 'break-word' }} type={'secondary'}>
          {copy.detail}
        </Text>
      )}
      {copy.choice && (
        <Flexbox horizontal align={'flex-start'} gap={6}>
          <Icon
            color={cssVar.colorPrimary}
            icon={ArrowRight}
            size={14}
            style={{ flex: 'none', marginBlockStart: 3 }}
          />
          <Text style={{ wordBreak: 'break-word' }} weight={500}>
            {copy.choice}
          </Text>
        </Flexbox>
      )}
    </Flexbox>
    {view.resolvedAt && <DecisionTime at={view.resolvedAt} />}
  </Flexbox>
);

export const GoalDecisionsMade = ({ graph }: { graph: GoalGraphView }) => {
  const { t } = useTranslation('chat');
  const decisions = buildUserDecisions(graph.decisions);
  const copyOf = useDecisionCopy(graph);

  return (
    <Flexbox gap={8}>
      <SectionTitle>{t('goalProcess.result.decisions.title')}</SectionTitle>
      {decisions.length === 0 ? (
        <Text fontSize={13} type={'secondary'}>
          {t('goalProcess.result.decisions.empty')}
        </Text>
      ) : (
        <Flexbox>
          {decisions.map((view) => (
            <DecisionItem copy={copyOf(view)} key={view.decision.id} view={view} />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
};

/**
 * 基于成果继续 — a new Goal seeded with this one's requirement, what it
 * delivered and what is still open. The create flow still lets the owner
 * rewrite all of it before anything runs.
 */
export const useContinueFromResult = (graph: GoalGraphView, outcomes: CriterionOutcome[]) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();

  return useCallback(() => {
    const { goal } = graph;
    const deliverable = pickFinalDeliverable(
      graph.artifacts,
      findFinalAcceptanceView(graph)?.node.id ?? '',
    );
    const open = [
      ...outcomes
        .filter((outcome) => outcome.state !== 'passed')
        .map((outcome) =>
          outcome.reason
            ? `${outcome.criterion.title}: ${outcome.reason}`
            : outcome.criterion.title,
        ),
      ...buildAbandonedNodes(graph).map(({ reason, view }) =>
        reason ? `${view.node.title}: ${reason}` : view.node.title,
      ),
    ];
    const requirement = [
      t('goalProcess.result.continueSeed.intro', { title: goal.title }),
      deliverable?.title &&
        t('goalProcess.result.continueSeed.deliverable', { title: deliverable.title }),
      goal.requirement &&
        `${t('goalProcess.result.continueSeed.requirement')}\n${goal.requirement}`,
      open.length > 0 &&
        `${t('goalProcess.result.continueSeed.open')}\n${open.map((line) => `- ${line}`).join('\n')}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    createGoalModal({
      agentId: goal.agentId ?? undefined,
      initialRequirement: requirement,
      initialTitle: t('goalProcess.result.continueSeed.title', { title: goal.title }),
      onCreated: (created) => {
        const ownerId = created.agentId ?? goal.agentId;
        navigate(ownerId ? `/agent/${ownerId}/goal/${created.goalId}` : `/goal/${created.goalId}`);
      },
      projectId: goal.projectId ?? undefined,
    });
  }, [graph, navigate, outcomes, t]);
};

const OpenItem = ({
  detail,
  icon,
  title,
  tone,
}: {
  detail?: string;
  icon: typeof Flag;
  title: string;
  tone: string;
}) => (
  <Flexbox horizontal className={styles.item} gap={12}>
    <Icon color={tone} icon={icon} size={16} style={{ flex: 'none', marginBlockStart: 2 }} />
    <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
      <Text style={{ wordBreak: 'break-word' }} weight={500}>
        {title}
      </Text>
      {detail && (
        <Text fontSize={13} style={{ wordBreak: 'break-word' }} type={'secondary'}>
          {detail}
        </Text>
      )}
    </Flexbox>
  </Flexbox>
);

const OpenGroup = ({ children, label }: { children: ReactNode; label: string }) => (
  <Flexbox gap={2}>
    <Text fontSize={12} type={'secondary'} weight={500}>
      {label}
    </Text>
    <Flexbox>{children}</Flexbox>
  </Flexbox>
);

export const GoalUnfinished = ({
  graph,
  onContinue,
  outcomes,
}: {
  graph: GoalGraphView;
  onContinue: () => void;
  outcomes: CriterionOutcome[];
}) => {
  const { t } = useTranslation('chat');
  const unmet = outcomes.filter((outcome) => outcome.state === 'failed');
  const abandoned = buildAbandonedNodes(graph);
  const nextSteps = graph.report?.latest?.metadata.nextSteps ?? [];
  const empty = unmet.length === 0 && abandoned.length === 0 && nextSteps.length === 0;

  return (
    <Flexbox gap={12}>
      <SectionTitle
        extra={
          <Button icon={ArrowRight} size={'small'} onClick={onContinue}>
            {t('goalProcess.result.unfinished.continue')}
          </Button>
        }
      >
        {t('goalProcess.result.unfinished.title')}
      </SectionTitle>
      {empty && (
        <Text fontSize={13} type={'secondary'}>
          {t('goalProcess.result.unfinished.empty')}
        </Text>
      )}
      {unmet.length > 0 && (
        <OpenGroup label={t('goalProcess.result.unfinished.unmetCriteria')}>
          {unmet.map((outcome) => (
            <OpenItem
              detail={outcome.reason}
              icon={XCircle}
              key={outcome.criterion.id}
              title={outcome.criterion.title}
              tone={cssVar.colorError}
            />
          ))}
        </OpenGroup>
      )}
      {abandoned.length > 0 && (
        <OpenGroup label={t('goalProcess.result.unfinished.abandoned')}>
          {abandoned.map(({ reason, view }) => (
            <OpenItem
              detail={reason}
              icon={CircleSlash}
              key={view.node.id}
              title={view.node.title}
              tone={cssVar.colorTextTertiary}
            />
          ))}
        </OpenGroup>
      )}
      {nextSteps.length > 0 && (
        <OpenGroup label={t('goalProcess.result.unfinished.nextSteps')}>
          {nextSteps.map((step) => (
            <OpenItem
              detail={step.reason}
              icon={Flag}
              key={step.title}
              title={step.title}
              tone={cssVar.colorPrimary}
            />
          ))}
        </OpenGroup>
      )}
    </Flexbox>
  );
};
