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
import RunningGlyph from '@/features/Home/components/RunningGlyph';
import { useActivityTime } from '@/hooks/useActivityTime';

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
    padding-block: 2px 14px;
    padding-inline: 46px 12px;
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
    font-weight: 600;
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
  addTask: (title: string) => Promise<void>;
  decide: (decisionId: string, optionId: string, resolution?: string) => void;
}

interface FrontierProps {
  actions: FrontierActions;
  canEdit: boolean;
  graph: GoalGraphView;
  onSelect: (nodeId: string) => void;
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
          <Text ellipsis fontSize={12} style={{ flex: 1, minWidth: 0 }} type={'secondary'}>
            {attempt.reason ?? ''}
          </Text>
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
  const { text } = useActivityTime(view.node.updatedAt);
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

  const tag =
    item.kind === 'gate'
      ? { color: 'warning', text: t('goalProcess.tag.needsDecision') }
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
          {node.title}
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
          {item.kind === 'gate' &&
            canEdit &&
            view.decision?.options?.map((option) => (
              <Tooltip key={option.id} title={option.description}>
                <Button
                  size={'small'}
                  type={option.id === view.decision?.recommendedOptionId ? 'primary' : 'default'}
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
      </Flexbox>

      {item.rank === 0 && (
        <Flexbox className={styles.body} gap={12} onClick={stop}>
          {item.kind === 'gate' && view.decision && (
            <>
              <Flexbox gap={4}>
                <span className={styles.label}>{t('goalProcess.gate.why')}</span>
                <Text fontSize={13}>{view.decision.question}</Text>
              </Flexbox>
              {!!view.decision.options?.length && (
                <Flexbox gap={6}>
                  <span className={styles.label}>{t('goalProcess.gate.options')}</span>
                  {view.decision.options.map((option) => (
                    <div className={styles.option} key={option.id}>
                      <Text fontSize={13} weight={500}>
                        {optionLabel(option)}
                        {option.id === view.decision?.recommendedOptionId
                          ? `（${t('goalProcess.gate.recommended')}）`
                          : ''}
                      </Text>
                      <Text fontSize={13} type={'secondary'}>
                        {option.description ?? ''}
                      </Text>
                    </div>
                  ))}
                </Flexbox>
              )}
            </>
          )}
          {item.kind === 'stale' && <StaleBody view={view} />}
          <AttemptLedger view={subject ?? view} />
          {item.kind === 'gate' && canEdit && (
            <Flexbox gap={4}>
              <span className={styles.label}>{t('goalProcess.gate.noteLabel')}</span>
              <TextArea
                autoSize={{ maxRows: 3, minRows: 1 }}
                placeholder={t('goalProcess.gate.notePlaceholder')}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Flexbox>
          )}
        </Flexbox>
      )}
    </Block>
  );
});

FrontierRow.displayName = 'GoalFrontierRow';

const AddTaskRow = memo<{ onAdd: (title: string) => Promise<void> }>(({ onAdd }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(title.trim());
      setTitle('');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <Button
        icon={<Icon icon={Plus} />}
        size={'small'}
        type={'text'}
        onClick={() => setOpen(true)}
      >
        {t('goalProcess.frontier.add')}
      </Button>
    );

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <TextArea
        autoFocus
        autoSize={{ maxRows: 2, minRows: 1 }}
        placeholder={t('goalProcess.frontier.add')}
        style={{ width: 260 }}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onPressEnter={(event) => {
          event.preventDefault();
          void submit();
        }}
      />
      <Button
        disabled={!title.trim()}
        loading={busy}
        size={'small'}
        type={'primary'}
        onClick={submit}
      >
        {t('goalProcess.frontier.add')}
      </Button>
    </Flexbox>
  );
});

AddTaskRow.displayName = 'GoalAddTaskRow';

const Frontier = memo<FrontierProps>(({ actions, canEdit, graph, onSelect }) => {
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
        {canEdit && <AddTaskRow onAdd={actions.addTask} />}
      </Flexbox>

      <div className={styles.list}>
        <Block gap={0} padding={2} variant={'borderless'}>
          {graph.frontier.length === 0 && (
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
          )}
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
