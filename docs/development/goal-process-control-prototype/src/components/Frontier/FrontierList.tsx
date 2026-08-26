import {
  ActionIcon,
  Block,
  Button,
  Flexbox,
  Icon,
  InputNumber,
  Tag,
  Text,
  TextArea,
  Tooltip,
} from '@lobehub/ui';
import { Divider } from 'antd';
import { createStyles } from 'antd-style';
import { ChevronDown, ChevronRight, Pencil, Plus, RotateCcw } from 'lucide-react';
import { Fragment, memo, useState } from 'react';

import { clock, short, usd } from '../../model/format';
import type { Frontier, FrontierItem } from '../../model/frontier';
import type { GoalState } from '../../types';
import { ActorAvatar, type ExecStatus, NewTag, StatusGlyph, useSharedStyles } from '../shared';

// "当前任务" — one row per thing that can move now, in the AgentTaskItem shape:
// [#n] [status glyph] title [status Tag] live text … [avatar] [time | actions]. Single line; details
// open in the right-side panel. Domain "Work" is always called 任务 on the surface.

const useStyles = createStyles(({ css, token }) => ({
  row: css`
    &:hover .row-actions {
      opacity: 1;
    }
  `,
  hoverActions: css`
    opacity: 0;
    transition: opacity 0.15s;
  `,
  num: css`
    flex: none;

    min-width: 22px;

    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    color: ${token.colorTextQuaternary};
  `,
  live: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: 12px;
    color: ${token.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
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
    color: ${token.colorTextTertiary};

    &:hover {
      color: ${token.colorTextSecondary};
    }
  `,
  dim: css`
    opacity: 0.6;
  `,
}));

export interface FrontierActions {
  decide: (optionId: string, reason?: string) => void;
  accept: () => void;
  reject: (comment: string) => void;
  addBudget: (cap: number) => void;
  reclaim: () => void;
  startNode: (id: string) => void;
}

interface FrontierListProps {
  state: GoalState;
  frontier: Frontier;
  hotId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string, edit?: boolean) => void;
  actions: FrontierActions;
}

const glyphOf = (item: FrontierItem, paused: boolean): { status: ExecStatus; live?: boolean } => {
  switch (item.kind) {
    case 'gate':
    case 'acceptance':
    case 'budget':
      return { status: 'waitingForHuman' };
    case 'stale':
      return { status: 'failed' };
    case 'running':
      return paused ? { status: 'paused' } : { status: 'running', live: true };
    default:
      return { status: 'backlog' };
  }
};

const tagOf = (state: GoalState, item: FrontierItem): { text: string; color?: string } => {
  const n = item.node;
  const { goal } = state;
  switch (item.kind) {
    case 'gate':
      return { text: '等你决定', color: 'warning' };
    case 'acceptance':
      return { text: '等你确认', color: 'warning' };
    case 'budget':
      return { text: '预算用完', color: 'warning' };
    case 'stale':
      return { text: '失联', color: 'error' };
    case 'running':
      return goal.status === 'paused'
        ? { text: '已停止' }
        : { text: `进行中 · 第 ${(n.attempts?.length ?? 0) + 1} 次`, color: 'processing' };
    default:
      return { text: goal.status === 'planning' ? '待开始' : '可以开始' };
  }
};

const titleOf = (state: GoalState, item: FrontierItem) => {
  const { goal } = state;
  if (item.kind === 'budget')
    return `费用预算用完了（${usd(goal.spent)} / ${usd(goal.maxTotalCost ?? 0)}）`;
  if (item.kind === 'acceptance') {
    const passed = goal.checks.filter((c) => c.state === 'passed').length;
    return `验收通过 ${passed}/${goal.checks.length}，这个目标算完成了吗？`;
  }
  return item.node.title;
};

/** Inline live text after the tag — from the owner Task's topic (last line) / the verifier reason. */
const liveOf = (state: GoalState, item: FrontierItem) => {
  const n = item.node;
  switch (item.kind) {
    case 'running':
      return state.goal.status === 'paused' ? '' : `${n.task?.agent}：${n.lastLine ?? ''}`;
    case 'stale':
      return `${n.task?.agent} 已 ${short(clock.now - (n.lastActivity ?? clock.now))} 没有心跳 · 下一次推进会自动重开`;
    case 'gate': {
      const d = state.decision;
      return d ? d.why.split('；')[0] : '';
    }
    case 'budget':
      return '已停下，不会再开始新的尝试';
    case 'acceptance':
      return '独立 verifier 复验了 checkpoint、loss 与采样';
    default:
      return '';
  }
};

export const FrontierList = memo<FrontierListProps>(
  ({ state, frontier, hotId, onHover, onSelect, actions }) => {
    const { styles, cx } = useStyles();
    const { styles: shared } = useSharedStyles();
    const { goal } = state;
    const [rejectOpen, setRejectOpen] = useState(false);
    const [comment, setComment] = useState('');
    const [budget, setBudget] = useState<number>((goal.maxTotalCost ?? 0) + 5);
    const [showBlocked, setShowBlocked] = useState(false);
    const paused = goal.status === 'paused';

    const stop = (e: React.MouseEvent) => e.stopPropagation();

    const rightCluster = (item: FrontierItem) => {
      const n = item.node;
      switch (item.kind) {
        case 'gate': {
          const d = state.decision!;
          const rec = d.options.find((o) => o.id === d.recommended)!;
          return (
            <>
              {d.options
                .filter((o) => o.id !== rec.id)
                .map((o) => (
                  <Tooltip key={o.id} title={o.consequence}>
                    <Button
                      size="small"
                      onClick={(e) => {
                        stop(e);
                        actions.decide(o.id);
                      }}
                    >
                      {o.label}
                    </Button>
                  </Tooltip>
                ))}
              <Tooltip title={`推荐 · ${rec.consequence}`}>
                <Button
                  type="primary"
                  size="small"
                  onClick={(e) => {
                    stop(e);
                    actions.decide(rec.id);
                  }}
                >
                  {rec.label}
                </Button>
              </Tooltip>
            </>
          );
        }
        case 'acceptance':
          return (
            <>
              <Button
                size="small"
                onClick={(e) => {
                  stop(e);
                  setRejectOpen(true);
                }}
              >
                还不够
              </Button>
              <Button
                type="primary"
                size="small"
                onClick={(e) => {
                  stop(e);
                  actions.accept();
                }}
              >
                确认完成
              </Button>
            </>
          );
        case 'budget':
          return (
            <>
              <InputNumber
                size="small"
                value={budget}
                min={goal.spent}
                step={1}
                prefix="$"
                onChange={(v) => setBudget(Number(v ?? 0))}
                style={{ width: 96 }}
                onClick={stop}
              />
              <Button
                type="primary"
                size="small"
                onClick={(e) => {
                  stop(e);
                  actions.addBudget(budget);
                }}
              >
                追加并继续
              </Button>
            </>
          );
        case 'stale':
          return (
            <Button
              type="primary"
              size="small"
              icon={<Icon icon={RotateCcw} />}
              onClick={(e) => {
                stop(e);
                actions.reclaim();
              }}
            >
              立即重开
            </Button>
          );
        case 'running':
          return (
            <>
              <ActorAvatar name={n.task?.agent ?? ''} />
              <Text fontSize={12} className={cx(shared.muted, shared.mono)}>
                {short(clock.now - (n.lastActivity ?? clock.now))}
              </Text>
            </>
          );
        default:
          return (
            <ActionIcon
              icon={Pencil}
              size="small"
              title="编辑这项任务"
              className={cx('row-actions', styles.hoverActions)}
              onClick={(e) => {
                stop(e);
                onSelect(n.id, true);
              }}
            />
          );
      }
    };

    const Row = ({ item, index, dim }: { item: FrontierItem; index: number; dim?: boolean }) => {
      const n = item.node;
      const g = glyphOf(item, paused);
      const tag = tagOf(state, item);
      const live = liveOf(state, item);
      return (
        <Block
          clickable
          variant="borderless"
          padding={12}
          className={cx(styles.row, dim && styles.dim)}
          onClick={() => onSelect(n.id)}
          onMouseEnter={() => onHover(n.id)}
          onMouseLeave={() => onHover(null)}
        >
          <Flexbox horizontal gap={10} align="center">
            <span className={styles.num}>#{index}</span>
            <StatusGlyph status={g.status} live={g.live} />
            <Text weight={500} ellipsis style={{ flexShrink: 1, minWidth: 0, maxWidth: '60%' }}>
              {titleOf(state, item)}
            </Text>
            <Tag size="small" color={tag.color as any}>
              {tag.text}
            </Tag>
            <span className={styles.live}>{live}</span>
            <Flexbox horizontal gap={8} align="center" style={{ flexShrink: 0 }}>
              {rightCluster(item)}
            </Flexbox>
          </Flexbox>
          {item.kind === 'acceptance' && rejectOpen && (
            <Flexbox gap={8} style={{ marginTop: 10, paddingLeft: 48 }} onClick={stop}>
              <TextArea
                autoFocus
                placeholder="哪里不够？会作为下一轮的输入"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                autoSize={{ minRows: 2, maxRows: 4 }}
              />
              <Flexbox horizontal gap={8} justify="flex-end">
                <Button size="small" onClick={() => setRejectOpen(false)}>
                  取消
                </Button>
                <Button
                  size="small"
                  type="primary"
                  disabled={!comment.trim()}
                  onClick={() => {
                    actions.reject(comment);
                    setRejectOpen(false);
                  }}
                >
                  带反馈再来一轮
                </Button>
              </Flexbox>
            </Flexbox>
          )}
        </Block>
      );
    };

    return (
      <Flexbox gap={8}>
        <Flexbox horizontal justify="space-between" align="baseline">
          <Flexbox horizontal gap={8} align="baseline">
            <Text fontSize={16} weight={600}>
              当前任务
            </Text>
            <Text fontSize={12} className={shared.muted}>
              {goal.status === 'planning'
                ? '开始后 Agent 按优先级逐项领取'
                : `${frontier.needsYou > 0 ? `${frontier.needsYou} 项需要你 · ` : ''}${frontier.items.length} 项能推进`}
            </Text>
          </Flexbox>
          <Button size="small" type="text" icon={<Icon icon={Plus} />}>
            添加任务
          </Button>
        </Flexbox>

        <div className={shared.list}>
          <Block variant="borderless" gap={0} padding={2}>
            {frontier.items.length === 0 && (
              <Flexbox padding={12} gap={2}>
                <Text weight={500}>
                  {goal.status === 'achieved'
                    ? '没有需要推进的了，目标已达成'
                    : '当前没有可推进的任务'}
                </Text>
                <Text fontSize={12} type="secondary">
                  {goal.status === 'achieved'
                    ? '结论都在下面的图里；可以基于任何结论再开一条新任务。'
                    : '所有任务都在等待或已终态。'}
                </Text>
              </Flexbox>
            )}
            {frontier.items.map((item, i) => (
              <Fragment key={item.key}>
                {i > 0 && <Divider dashed style={{ margin: 0 }} />}
                <Row item={item} index={i + 1} />
              </Fragment>
            ))}
          </Block>
          {frontier.blocked.length > 0 && (
            <>
              <Divider dashed style={{ margin: 0 }} />
              <div className={styles.blockedHead} onClick={() => setShowBlocked(!showBlocked)}>
                <Icon icon={showBlocked ? ChevronDown : ChevronRight} size={12} />
                <span>还有 {frontier.blocked.length} 项在等依赖</span>
                {!showBlocked && (
                  <span className={styles.live} style={{ marginLeft: 4 }}>
                    {frontier.blocked.map((b) => b.node.title).join(' · ')}
                  </span>
                )}
              </div>
              {showBlocked && (
                <Block variant="borderless" gap={0} padding={2}>
                  {frontier.blocked.map((b, i) => (
                    <Fragment key={b.key}>
                      {i > 0 && <Divider dashed style={{ margin: 0 }} />}
                      <Block
                        clickable
                        variant="borderless"
                        padding={12}
                        className={cx(styles.row, styles.dim)}
                        onClick={() => onSelect(b.node.id, true)}
                        onMouseEnter={() => onHover(b.node.id)}
                        onMouseLeave={() => onHover(null)}
                      >
                        <Flexbox horizontal gap={10} align="center">
                          <span className={styles.num}>#{frontier.items.length + i + 1}</span>
                          <StatusGlyph status="backlog" />
                          <Text weight={500} ellipsis style={{ flexShrink: 1, minWidth: 0 }}>
                            {b.node.title}
                          </Text>
                          <Tag size="small">
                            等「{b.blockers[0].title.slice(0, 12)}
                            {b.blockers[0].title.length > 12 ? '…' : ''}」
                            {b.blockers.length > 1 ? ` 等 ${b.blockers.length} 项` : ''}
                          </Tag>
                          <span className={styles.live} />
                          <ActionIcon
                            icon={Pencil}
                            size="small"
                            title="编辑这项任务"
                            className={cx('row-actions', styles.hoverActions)}
                            onClick={(e) => {
                              stop(e);
                              onSelect(b.node.id, true);
                            }}
                          />
                        </Flexbox>
                      </Block>
                    </Fragment>
                  ))}
                </Block>
              )}
            </>
          )}
        </div>
      </Flexbox>
    );
  },
);
