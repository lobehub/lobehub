'use client';

import type { AcceptanceStatus } from '@lobechat/types';
import {
  Block,
  Button,
  createStaticStyles,
  cssVar,
  Divider,
  Flexbox,
  Icon,
  Tag,
  Text,
} from '@lobehub/ui';
import { ChevronDown, ChevronRight, History, ListTodo, Plus } from 'lucide-react';
import { Fragment, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';
import { openAddGoalTaskModal } from '@/features/AgentGoals/AddTaskModal';
import RunningGlyph from '@/features/Home/components/RunningGlyph';
import { useActivityTime } from '@/hooks/useActivityTime';
import { useChatStore } from '@/store/chat';

import GoalClarification, { type PendingGoalClarification } from '../GoalClarification';
import GoalDecisionCase, {
  type GoalGateCategory,
  goalGateCategory,
  useGateSummary,
} from '../GoalDecision';
import AssigneeProfileAvatar from './AssigneeProfileAvatar';
import {
  coordinatorGateReason,
  coordinatorNodeTitleKey,
  coordinatorReasonCopy,
  viewGateKind,
} from './coordinatorCopy';
import type { FrontierItem, GoalGraphView, GoalNodeView } from './goalGraphViewModel';
import { useElapsed } from './useElapsed';

/**
 * 当前任务 — one row per thing that can change state now, in the AgentTaskItem
 * shape: `#n · glyph · title · state tag · … · actions`. Rows that need a human
 * open their whole case in place (why it stopped, what each option costs, the
 * attempt ledger) instead of truncating it onto the title line. Just-finished
 * tasks stay at the top, dimmed, so the list fades rather than items vanishing;
 * blocked ones fold at the bottom and reference blockers by the same numbers
 * the rows carry.
 */

const styles = createStaticStyles(({ css }) => ({
  attempt: css`
    padding-block: 6px;

    & + & {
      border-block-start: 1px dashed ${cssVar.colorBorderSecondary};
    }
  `,
  blockedHead: css`
    cursor: pointer;
    user-select: none;

    display: flex;
    gap: 6px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 12px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  body: css`
    /* Aligned with the row title (glyph + gap), not floated on its own indent. */
    padding-block: 8px 14px;
    padding-inline: 26px 12px;
  `,
  // A gate is an intent card: lifted off the list so it reads as the one thing
  // asking for the owner, not another row.
  decisionCard: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowTertiary};
  `,
  deps: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
  dim: css`
    opacity: 0.55;
    transition: opacity 0.15s;

    &:hover {
      opacity: 1;
    }
  `,
  label: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  list: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgContainer};
  `,
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
    font-variant-numeric: tabular-nums;
  `,
  num: css`
    flex: none;

    min-width: 22px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
  option: css`
    display: grid;
    grid-template-columns: 128px 1fr;
    gap: 8px;
    align-items: baseline;
  `,
}));

export interface FrontierActions {
  addTask: (title: string, description?: string) => Promise<void>;
  decide: (decisionId: string, optionId: string, resolution?: string) => Promise<unknown>;
}

interface FrontierProps {
  actions: FrontierActions;
  canEdit: boolean;
  graph: GoalGraphView;
  onSelect: (nodeId: string) => void;
  /** The coordinator is still decomposing — the empty list is a promise, not a lull. */
  planning?: boolean;
}

const RowGlyph = memo<{ kind: FrontierItem['kind']; view: GoalNodeView }>(({ kind, view }) => {
  switch (kind) {
    case 'done': {
      const visual =
        view.node.status === 'resolved'
          ? TASK_STATUS_VISUALS.completed
          : TASK_STATUS_VISUALS.canceled;
      return <Icon color={visual.color} icon={visual.icon} size={16} />;
    }
    case 'gate': {
      return (
        <Icon
          color={TASK_STATUS_VISUALS.paused.color}
          icon={TASK_STATUS_VISUALS.paused.icon}
          size={16}
        />
      );
    }
    case 'running': {
      return <RunningGlyph size={16} />;
    }
    case 'stale': {
      return (
        <Icon
          color={TASK_STATUS_VISUALS.failed.color}
          icon={TASK_STATUS_VISUALS.failed.icon}
          size={16}
        />
      );
    }
    default: {
      return (
        <Icon
          color={TASK_STATUS_VISUALS.backlog.color}
          icon={TASK_STATUS_VISUALS.backlog.icon}
          size={16}
        />
      );
    }
  }
});

RowGlyph.displayName = 'GoalFrontierRowGlyph';

const AttemptReason = memo<{ reason?: string | null }>(({ reason }) => {
  const { t } = useTranslation('chat');
  const copy = coordinatorReasonCopy(reason);
  return (
    <Text ellipsis fontSize={12} style={{ flex: 1, minWidth: 0 }} type={'secondary'}>
      {copy ? t(copy.key as any, copy.params) : (reason ?? '')}
    </Text>
  );
});

AttemptReason.displayName = 'GoalAttemptReason';

const AttemptLedger = memo<{ view: GoalNodeView }>(({ view }) => {
  const { t } = useTranslation('chat');
  if (view.attempts.length === 0) return null;

  return (
    <Flexbox gap={0}>
      <span className={styles.label}>{t('goalProcess.attempts.title')}</span>
      {view.attempts.map((attempt) => (
        <Flexbox
          horizontal
          align={'baseline'}
          className={styles.attempt}
          gap={10}
          key={attempt.index}
        >
          <Text
            className={styles.mono}
            fontSize={12}
            style={{ flex: 'none', width: 60 }}
            type={'secondary'}
          >
            {t('goalProcess.attempts.nth', { index: attempt.index })}
          </Text>
          <Text
            fontSize={12}
            style={{ flex: 'none' }}
            type={
              attempt.outcome === 'passed'
                ? 'success'
                : attempt.outcome === 'failed'
                  ? 'danger'
                  : 'secondary'
            }
          >
            {t(`goalProcess.attempts.${attempt.outcome}` as const)}
          </Text>
          <AttemptReason reason={attempt.reason} />
        </Flexbox>
      ))}
    </Flexbox>
  );
});

AttemptLedger.displayName = 'GoalAttemptLedger';

/** The running clock lives in its own component so the 1s tick never re-renders the list. */
const RunningClock = memo<{ startedAt?: Date }>(({ startedAt }) => {
  const elapsed = useElapsed(startedAt);
  if (!elapsed) return null;
  return (
    <Text className={styles.mono} fontSize={12} type={'secondary'}>
      {elapsed}
    </Text>
  );
});

RunningClock.displayName = 'GoalRunningClock';

const DoneTime = memo<{ view: GoalNodeView }>(({ view }) => {
  const { text, title } = useActivityTime(view.node.resolvedAt ?? view.node.updatedAt);
  return (
    <Text className={styles.mono} fontSize={12} title={title} type={'secondary'}>
      {text || '—'}
    </Text>
  );
});

DoneTime.displayName = 'GoalDoneTime';

const StaleBody = memo<{ view: GoalNodeView }>(({ view }) => {
  const { t } = useTranslation('chat');
  const { text } = useActivityTime(view.heartbeatAt);
  return (
    <Text fontSize={13} type={'secondary'}>
      {t('goalProcess.stale.description', { duration: text })}
    </Text>
  );
});

StaleBody.displayName = 'GoalStaleBody';

/**
 * Whether this task's own delivery held up.
 *
 * Only the statuses a reader would act on: a settled judgment, a rejection, a
 * delivery waiting on them, or a verification that broke. `pending` / `planned`
 * say nothing yet, and `verifying` / `repairing` are already what the row's own
 * state chip says — repeating either would cost the row its scannability for no
 * information.
 *
 * `verifying` / `repairing` are in the map even though the row's own state chip
 * already names them: that chip is a label, and while the judgment is running is
 * exactly when a reader wants to look INTO it. Leaving them out meant the one
 * state where the acceptance matters most offered no way to reach it.
 */
const ACCEPTANCE_CHIP: Partial<Record<AcceptanceStatus, { color: string; key: string }>> = {
  accepted: { color: 'success', key: 'accepted' },
  delivered: { color: 'info', key: 'delivered' },
  errored: { color: 'error', key: 'errored' },
  rejected: { color: 'error', key: 'rejected' },
  repairing: { color: 'info', key: 'repairing' },
  verifying: { color: 'info', key: 'verifying' },
};

const AcceptanceChip = memo<{ view: GoalNodeView }>(({ view }) => {
  const { t } = useTranslation('chat');
  const openAcceptance = useChatStore((s) => s.openAcceptance);
  const acceptance = view.acceptance;
  const chip = acceptance ? ACCEPTANCE_CHIP[acceptance.status] : undefined;
  if (!acceptance || !chip) return null;

  return (
    <Tag
      color={chip.color}
      size={'small'}
      style={{ cursor: 'pointer' }}
      // The evidence is the point: the chip is the way into it, opened in the
      // side Portal like every other drill-down on this page.
      onClick={(event) => {
        event.stopPropagation();
        openAcceptance(acceptance.id);
      }}
    >
      {t(`goalProcess.acceptance.${chip.key}` as any)}
    </Tag>
  );
});

AcceptanceChip.displayName = 'GoalAcceptanceChip';

/**
 * What a gate's answer should be weighed against: the Task it stopped, one
 * click from its run and its acceptance, and what each attempt did. Folded to
 * one line until opened — the question leads, the proof is on demand.
 */
/**
 * The way into what a gate stands on, as quiet links on its answer row: open
 * the Task's run, and fold its attempts open beneath the card.
 */
const GateLinks = memo<{
  ledgerOpen: boolean;
  onOpen: () => void;
  onToggleLedger: () => void;
  subject: GoalNodeView;
}>(({ ledgerOpen, onOpen, onToggleLedger, subject }) => {
  const { t } = useTranslation('chat');
  const attempts = subject.attempts.length;
  const quiet = { color: cssVar.colorTextSecondary };

  return (
    <>
      <Button icon={ListTodo} size={'small'} style={quiet} type={'text'} onClick={onOpen}>
        {t('goalProcess.decision.viewRun')}
      </Button>
      {attempts > 0 && (
        <Button
          icon={ledgerOpen ? ChevronDown : History}
          size={'small'}
          style={quiet}
          type={'text'}
          onClick={onToggleLedger}
        >
          {t('goalProcess.decision.attempts', { count: attempts })}
        </Button>
      )}
      <AcceptanceChip view={subject} />
    </>
  );
});

GateLinks.displayName = 'GoalGateLinks';

/**
 * A gate the owner answers, as one card of its own above the task list: who is
 * asking, what about, the question and its answers. Lifted out of the list —
 * a decision is the one thing on the page waiting for the reader, not another
 * row in it.
 */
const GateCard = memo<{
  actions: FrontierActions;
  canEdit: boolean;
  category: Exclude<GoalGateCategory, 'clarify'>;
  goalAgentId?: string | null;
  numbers: Map<string, number>;
  onSelect: (nodeId: string) => void;
  subject?: GoalNodeView;
  view: GoalNodeView;
}>(({ actions, canEdit, category, goalAgentId, numbers, onSelect, subject, view }) => {
  const { t } = useTranslation('chat');
  const gateSummary = useGateSummary();
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const taskSubject = subject?.node.kind === 'task' ? subject : undefined;
  const subjectTitle =
    subject?.node.kind === 'task'
      ? (() => {
          const key = coordinatorNodeTitleKey(subject);
          return key ? t(key as any) : subject.node.title;
        })()
      : undefined;
  return (
    <div className={styles.decisionCard} data-goal-gate={view.decision!.id}>
      <GoalDecisionCase
        agentId={goalAgentId}
        basis={view.node.description}
        canAnswer={canEdit}
        category={category}
        decision={view.decision!}
        evidence={taskSubject && ledgerOpen ? <AttemptLedger view={taskSubject} /> : undefined}
        summary={gateSummary(category, subjectTitle)}
        footer={
          // A goal-level question (the main Agent asking about the goal itself)
          // stopped no Task, so there is no run to open.
          taskSubject ? (
            <GateLinks
              ledgerOpen={ledgerOpen}
              subject={taskSubject}
              onOpen={() => onSelect(taskSubject.node.id)}
              onToggleLedger={() => setLedgerOpen(!ledgerOpen)}
            />
          ) : undefined
        }
        task={
          taskSubject && subjectTitle
            ? {
                description: taskSubject.node.description,
                onOpen: () => onSelect(taskSubject.node.id),
                title:
                  numbers.get(taskSubject.node.id) !== undefined
                    ? `#${numbers.get(taskSubject.node.id)} ${subjectTitle}`
                    : subjectTitle,
              }
            : undefined
        }
        onDecide={(optionId, resolution) => actions.decide(view.decision!.id, optionId, resolution)}
      />
    </div>
  );
});

GateCard.displayName = 'GoalGateCard';

const FrontierRow = memo<{
  item: FrontierItem;
  numbers: Map<string, number>;
  onSelect: (nodeId: string) => void;
  /** A gate's ledger is the ledger of the Task it was opened for. */
  subject?: GoalNodeView;
}>(({ item, numbers, onSelect, subject }) => {
  const { t } = useTranslation('chat');
  const { view } = item;
  const { node } = view;
  const deps = view.dependsOn.map((id) => numbers.get(id)).filter(Boolean);

  // Coordinator-authored gates carry English strings; recognized shapes render
  // in the user's language, arbitrary gates keep their stored copy.
  const coordinatorTitleKey = coordinatorNodeTitleKey(view);
  const gateKind = item.kind === 'gate' ? viewGateKind(view) : undefined;
  const rawGateReason = gateKind ? coordinatorGateReason(view.decision?.question) : undefined;
  const gateReasonCopy = coordinatorReasonCopy(rawGateReason);
  const gateReasonText = gateReasonCopy
    ? t(gateReasonCopy.key as any, gateReasonCopy.params)
    : rawGateReason;

  // Gate rows carry no tag: the expanded card with its action buttons already
  // says "this needs you", and a warning chip next to it is noise.
  // While verifying, the acceptance chip carries the same word AND opens the
  // judgment, so a second inert label beside it would only take space.
  const verifyingChipShown =
    item.kind === 'verifying' && !!view.acceptance && !!ACCEPTANCE_CHIP[view.acceptance.status];
  const tag =
    item.kind === 'verifying'
      ? verifyingChipShown
        ? null
        : { color: 'info', text: t('goalProcess.tag.verifying') }
      : item.kind === 'stale'
        ? { color: 'error', text: t('goalProcess.tag.lost') }
        : item.kind === 'done'
          ? {
              color: undefined,
              text:
                node.status === 'resolved'
                  ? t('goalProcess.tag.done')
                  : t('goalProcess.tag.retired'),
            }
          : null;

  return (
    <Block
      clickable
      className={item.kind === 'done' ? styles.dim : undefined}
      padding={12}
      variant={'borderless'}
      onClick={() => onSelect(node.id)}
    >
      <Flexbox horizontal align={'center'} gap={10}>
        {view.seq !== undefined && <span className={styles.num}>#{view.seq}</span>}
        <RowGlyph kind={item.kind} view={view} />
        {view.assigneeAgentId && <AssigneeProfileAvatar agentId={view.assigneeAgentId} />}
        <Text ellipsis style={{ flexShrink: 1, maxWidth: '60%', minWidth: 0 }} weight={500}>
          {coordinatorTitleKey ? t(coordinatorTitleKey as any) : node.title}
        </Text>
        {tag && (
          <Tag color={tag.color} size={'small'}>
            {tag.text}
          </Tag>
        )}
        {deps.length > 0 && (
          <span className={styles.deps}>
            {t('goalProcess.frontier.dependsOn', { refs: deps.map((d) => `#${d}`).join(' ') })}
          </span>
        )}
        <Flexbox flex={1} />
        <Flexbox horizontal align={'center'} gap={8} style={{ flex: 'none' }}>
          <AcceptanceChip view={view} />
          {item.kind === 'running' && <RunningClock startedAt={view.startedAt} />}
          {item.kind === 'done' && <DoneTime view={view} />}
        </Flexbox>
      </Flexbox>

      {item.rank === 0 && (
        // The expanded body is READ-ONLY content — why it stopped and what each
        // attempt did — so it must stay part of the row's click target. It used
        // to stop propagation wholesale for the gate form's sake, which made a
        // lost/gate row unopenable in practice: the body is most of the row's
        // height, so a click aimed anywhere natural landed in dead space while
        // the pointer cursor still promised otherwise. Only the form below opts
        // out.
        <Flexbox className={styles.body} gap={14}>
          {item.kind === 'gate' && view.decision && (
            <Text fontSize={13} weight={500}>
              {gateReasonText ?? view.decision.question}
            </Text>
          )}
          {gateKind === 'clarifyGoal' && node.description && (
            // What changes with the answer — the reason the question is worth
            // stopping for, which the bare question does not say.
            <Text fontSize={13} type={'secondary'}>
              {node.description}
            </Text>
          )}
          {item.kind === 'stale' && <StaleBody view={view} />}
          <AttemptLedger view={subject ?? view} />
        </Flexbox>
      )}
    </Block>
  );
});

FrontierRow.displayName = 'GoalFrontierRow';

/** Opening a modal keeps the frontier header quiet — the brief gets a real form. */
const AddTaskButton = memo<{ onAdd: FrontierActions['addTask'] }>(({ onAdd }) => {
  const { t } = useTranslation('chat');
  return (
    <Button
      icon={<Icon icon={Plus} />}
      size={'small'}
      type={'text'}
      onClick={() => openAddGoalTaskModal({ onAdd })}
    >
      {t('goalProcess.frontier.add')}
    </Button>
  );
});

AddTaskButton.displayName = 'GoalAddTaskButton';

const Frontier = memo<FrontierProps>(({ actions, canEdit, graph, onSelect, planning }) => {
  const { t } = useTranslation('chat');
  const [showBlocked, setShowBlocked] = useState(false);

  const numbers = new Map(
    graph.nodes.filter((view) => view.seq !== undefined).map((view) => [view.node.id, view.seq!]),
  );
  const achieved = graph.goal.status === 'achieved';
  // A goal's clarification round is asked as one form, not one gate row per
  // question. Someone who cannot answer still sees the questions as rows.
  const clarifyItems = canEdit
    ? graph.frontier.filter(
        (item) => item.kind === 'gate' && viewGateKind(item.view) === 'clarifyGoal',
      )
    : [];
  // Every other gate is its own decision card above the list.
  const gateCards = graph.frontier.flatMap((item) => {
    if (item.kind !== 'gate' || !item.view.decision) return [];
    const category = goalGateCategory({
      nodeTitle: item.view.node.title,
      options: item.view.decision.options,
    });
    return category === 'clarify' ? [] : [{ category, item }];
  });
  const rows = graph.frontier.filter(
    (item) => !clarifyItems.includes(item) && !gateCards.some((gate) => gate.item === item),
  );
  const pendingClarifications: PendingGoalClarification[] = clarifyItems.map(({ view }) => ({
    decisionId: view.decision!.id,
    description: view.node.description,
    options: view.decision!.options,
    question: view.decision!.question,
  }));

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align={'baseline'} justify={'space-between'}>
        <Flexbox horizontal align={'baseline'} gap={8}>
          <Text fontSize={16} weight={600}>
            {t('goalProcess.frontier.title')}
          </Text>
          {graph.frontier.length > 0 && (
            <Text fontSize={12} type={'secondary'}>
              {graph.needsYou > 0
                ? `${t('goalProcess.frontier.needsYou', { count: graph.needsYou })} · `
                : ''}
              {t('goalProcess.frontier.advanceable', { count: graph.advanceable })}
            </Text>
          )}
        </Flexbox>
        {canEdit && <AddTaskButton onAdd={actions.addTask} />}
      </Flexbox>

      {gateCards.map(({ category, item }) => (
        <GateCard
          actions={actions}
          canEdit={canEdit}
          category={category}
          goalAgentId={graph.goal.agentId}
          key={item.key}
          numbers={numbers}

          subject={item.view.gateSubjectId ? graph.byId[item.view.gateSubjectId] : undefined}
          view={item.view}
          onSelect={onSelect}
        />
      ))}

      {(rows.length > 0 ||
        pendingClarifications.length > 0 ||
        graph.blocked.length > 0 ||
        graph.frontier.length === 0) && (
        <div className={styles.list}>
          <Block gap={0} padding={2} variant={'borderless'}>
            {graph.frontier.length === 0 &&
              (planning ? (
                <Flexbox horizontal align={'center'} gap={10} padding={12}>
                  <RunningGlyph size={16} />
                  <Flexbox gap={2}>
                    <Text weight={500}>{t('goalProcess.planning.title')}</Text>
                    <Text fontSize={12} type={'secondary'}>
                      {t('goalProcess.planning.description')}
                    </Text>
                  </Flexbox>
                </Flexbox>
              ) : (
                <Flexbox gap={2} padding={12}>
                  <Text weight={500}>
                    {achieved
                      ? t('goalProcess.frontier.achievedTitle')
                      : t('goalProcess.frontier.emptyTitle')}
                  </Text>
                  <Text fontSize={12} type={'secondary'}>
                    {achieved
                      ? t('goalProcess.frontier.achievedDescription')
                      : t('goalProcess.frontier.emptyDescription')}
                  </Text>
                </Flexbox>
              ))}
            {pendingClarifications.length > 0 && (
              // Filled so the one thing blocking the goal stands apart from the
              // task rows around it.
              <Block gap={12} padding={12} variant={'filled'}>
                <Flexbox gap={2}>
                  <Text weight={500}>{t('goalProcess.clarify.title')}</Text>
                  <Text fontSize={12} type={'secondary'}>
                    {t('goalProcess.clarify.description')}
                  </Text>
                </Flexbox>
                <GoalClarification goalId={graph.goal.id} pending={pendingClarifications} />
              </Block>
            )}
            {rows.map((item, index) => (
              <Fragment key={item.key}>
                {(index > 0 || pendingClarifications.length > 0) && (
                  <Divider dashed style={{ margin: 0 }} />
                )}
                <FrontierRow
                  item={item}
                  numbers={numbers}
                  subject={
                    item.view.gateSubjectId ? graph.byId[item.view.gateSubjectId] : undefined
                  }
                  onSelect={onSelect}
                />
              </Fragment>
            ))}
          </Block>
          {graph.blocked.length > 0 && (
            <>
              <Divider dashed style={{ margin: 0 }} />
              <div className={styles.blockedHead} onClick={() => setShowBlocked(!showBlocked)}>
                <Icon icon={showBlocked ? ChevronDown : ChevronRight} size={12} />
                <span>{t('goalProcess.frontier.blocked', { count: graph.blocked.length })}</span>
              </div>
              {showBlocked && (
                <Block gap={0} padding={2} variant={'borderless'}>
                  {graph.blocked.map((view, index) => (
                    <Fragment key={view.node.id}>
                      {index > 0 && <Divider dashed style={{ margin: 0 }} />}
                      <FrontierRow
                        item={{ key: view.node.id, kind: 'ready', rank: 3, view }}
                        numbers={numbers}
                        onSelect={onSelect}
                      />
                    </Fragment>
                  ))}
                </Block>
              )}
            </>
          )}
        </div>
      )}
    </Flexbox>
  );
});

Frontier.displayName = 'GoalFrontier';

export default Frontier;
