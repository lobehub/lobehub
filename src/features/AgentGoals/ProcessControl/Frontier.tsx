'use client';

import type { GoalDecisionOption } from '@lobechat/types';
import { Block, Flexbox, Icon, TextArea, Tooltip } from '@lobehub/ui';
import { Button, Tag, Text } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Fragment, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';
import { openAddGoalTaskModal } from '@/features/AgentGoals/AddTaskModal';
import RunningGlyph from '@/features/Home/components/RunningGlyph';
import { useActivityTime } from '@/hooks/useActivityTime';

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
  decide: (decisionId: string, optionId: string, resolution?: string) => void;
}

interface FrontierProps {
  actions: FrontierActions;
  canEdit: boolean;
  graph: GoalGraphView;
  onSelect: (nodeId: string) => void;
  /** The coordinator is still decomposing — the empty list is a promise, not a lull. */
  planning?: boolean;
}

/** Server option ids are stable; their labels are English strings from the coordinator. */
const useOptionLabel = () => {
  const { t } = useTranslation('chat');
  return (option: GoalDecisionOption) => {
    switch (option.id) {
      case 'fail': {
        return t('goalProcess.gate.option.fail');
      }
      case 'retire': {
        return t('goalProcess.gate.option.retire');
      }
      case 'retry': {
        return t('goalProcess.gate.option.retry');
      }
      default: {
        return option.label;
      }
    }
  };
};

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

const FrontierRow = memo<{
  actions: FrontierActions;
  canEdit: boolean;
  item: FrontierItem;
  numbers: Map<string, number>;
  onSelect: (nodeId: string) => void;
  /** A gate's ledger is the ledger of the Work it was opened for. */
  subject?: GoalNodeView;
}>(({ actions, canEdit, item, numbers, onSelect, subject }) => {
  const { t } = useTranslation('chat');
  const optionLabel = useOptionLabel();
  const [note, setNote] = useState('');
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
  const tag =
    item.kind === 'stale'
      ? { color: 'error', text: t('goalProcess.tag.lost') }
      : item.kind === 'done'
        ? {
            color: undefined,
            text:
              node.status === 'resolved' ? t('goalProcess.tag.done') : t('goalProcess.tag.retired'),
          }
        : null;

  const stop = (event: React.MouseEvent) => event.stopPropagation();

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
          {item.kind === 'running' && <RunningClock startedAt={view.startedAt} />}
          {item.kind === 'done' && <DoneTime view={view} />}
        </Flexbox>
      </Flexbox>

      {item.rank === 0 && (
        <Flexbox className={styles.body} gap={14} onClick={stop}>
          {item.kind === 'gate' && view.decision && (
            // State the problem itself, in the user's language when the
            // coordinator's vocabulary is recognized — the buttons below
            // already carry the choices, so no extra framing sentence.
            <Text fontSize={13} weight={500}>
              {gateReasonText ?? view.decision.question}
            </Text>
          )}
          {item.kind === 'stale' && <StaleBody view={view} />}
          <AttemptLedger view={subject ?? view} />
          {item.kind === 'gate' && canEdit && (
            <>
              <Flexbox gap={4}>
                <span className={styles.label}>{t('goalProcess.gate.noteLabel')}</span>
                <TextArea
                  autoSize={{ maxRows: 3, minRows: 1 }}
                  placeholder={t('goalProcess.gate.notePlaceholder')}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </Flexbox>
              {/* Actions close the card: read the situation, add guidance, then decide. */}
              <Flexbox horizontal gap={8}>
                {view.decision?.options?.map((option) => (
                  <Tooltip key={option.id} title={option.description}>
                    <Button
                      type={
                        option.id === view.decision?.recommendedOptionId ? 'primary' : 'default'
                      }
                      onClick={(event) => {
                        stop(event);
                        actions.decide(view.decision!.id, option.id, note.trim() || undefined);
                      }}
                    >
                      {optionLabel(option)}
                    </Button>
                  </Tooltip>
                ))}
              </Flexbox>
            </>
          )}
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
          {graph.frontier.map((item, index) => (
            <Fragment key={item.key}>
              {index > 0 && <Divider dashed style={{ margin: 0 }} />}
              <FrontierRow
                actions={actions}
                canEdit={canEdit}
                item={item}
                numbers={numbers}
                subject={item.view.gateSubjectId ? graph.byId[item.view.gateSubjectId] : undefined}
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
                      actions={actions}
                      canEdit={canEdit}
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
    </Flexbox>
  );
});

Frontier.displayName = 'GoalFrontier';

export default Frontier;
