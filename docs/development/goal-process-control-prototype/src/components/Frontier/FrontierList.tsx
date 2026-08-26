import {
  ActionIcon,
  Block,
  Button,
  Flexbox,
  Icon,
  InputNumber,
  Text,
  TextArea,
  Tooltip,
} from '@lobehub/ui';
import { Divider } from 'antd';
import { createStyles } from 'antd-style';
import {
  AlertTriangle,
  Check,
  CircleDashed,
  Clock,
  Coins,
  Loader,
  Pause,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import { Fragment, memo, useState } from 'react';

import { ago, clock, short, usd } from '../../model/format';
import type { Frontier, FrontierItem } from '../../model/frontier';
import { nodeStateText } from '../../model/frontier';
import type { GoalNode, GoalState } from '../../types';
import { ActorAvatar, NewTag, useSharedStyles } from '../shared';

// Rows mirror AgentTaskItem (src/features/AgentTasks/features/AgentTaskItem.tsx): a clickable Block,
// status glyph · title · meta on the right, dashed dividers between rows. Decisions are the same row
// with their two buttons on the right; details live in the node panel under the graph, not inline.

const useStyles = createStyles(({ css, token }) => ({
  row: css`
    position: relative;

    &:hover .row-actions {
      opacity: 1;
    }
  `,
  rowHot: css`
    box-shadow: inset 3px 0 0 ${token.colorPrimary};
  `,
  hoverActions: css`
    opacity: 0;
    transition: opacity 0.15s;
  `,
  glyph: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 16px;
  `,
  second: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  blocked: css`
    padding-block: 8px 4px;
    padding-inline: 12px;
    font-size: 12px;
    color: ${token.colorTextTertiary};
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
  freshIds: Set<string>;
  onHover: (id: string | null) => void;
  onSelect: (id: string, edit?: boolean) => void;
  actions: FrontierActions;
}

const Glyph = ({ item, paused }: { item: FrontierItem; paused: boolean }) => {
  const { styles } = useSharedStyles();
  switch (item.kind) {
    case 'gate':
      return <Icon icon={AlertTriangle} size={16} color="var(--ant-color-warning)" />;
    case 'acceptance':
      return <Icon icon={ShieldCheck} size={16} color="var(--ant-color-warning)" />;
    case 'budget':
      return <Icon icon={Coins} size={16} color="var(--ant-color-warning)" />;
    case 'stale':
      return <Icon icon={WifiOff} size={16} color="var(--ant-color-error)" />;
    case 'running':
      return paused ? (
        <Icon icon={Pause} size={16} color="var(--ant-color-text-tertiary)" />
      ) : (
        <Icon icon={Loader} size={16} className={styles.spin} color="var(--ant-color-info)" />
      );
    default:
      return <Icon icon={CircleDashed} size={16} color="var(--ant-color-text-quaternary)" />;
  }
};

const rowTitle = (state: GoalState, item: FrontierItem) => {
  const { goal } = state;
  if (item.kind === 'budget')
    return `费用预算用完了（${usd(goal.spent)} / ${usd(goal.maxTotalCost ?? 0)}）`;
  if (item.kind === 'acceptance') {
    const passed = goal.checks.filter((c) => c.state === 'passed').length;
    return `验收通过 ${passed}/${goal.checks.length}，这个 Goal 算完成了吗？`;
  }
  return item.node.title;
};

/** The second line: where the row's live text comes from is the owner Task's topic + heartbeat. */
const secondLine = (state: GoalState, item: FrontierItem, frontier: Frontier) => {
  const n = item.node;
  const { goal } = state;
  switch (item.kind) {
    case 'gate': {
      const d = state.decision;
      const w = d ? state.nodes.find((x) => x.id === d.workId) : undefined;
      return d && w
        ? `「${w.title}」已试 ${w.attempts?.filter((a) => a.outcome !== 'abandoned').length} 次 · ${d.why.split('；')[0]}`
        : n.body;
    }
    case 'acceptance':
      return '独立 verifier 重新加载了 checkpoint、核对了 loss 和采样长度；确认后记为已达成，不够就带反馈再来一轮。';
    case 'budget':
      return `已花 ${usd(goal.spent)}，上限 ${usd(goal.maxTotalCost ?? 0)} · 已停下，不会再开始新的尝试`;
    case 'stale':
      return `${n.task?.agent} 已 ${ago(clock.now - (n.lastActivity ?? clock.now)).replace('前', '')}没有心跳 · 下一次推进会自动重开，不算失败次数`;
    case 'running':
      if (goal.status === 'paused')
        return `已停止 · 第 ${(n.attempts?.length ?? 0) + 1} 次尝试会在继续后接着跑`;
      return `${n.task?.agent} · 第 ${(n.attempts?.length ?? 0) + 1} 次尝试 · 最近：${n.lastLine ?? ''}`;
    default:
      return goal.status === 'planning'
        ? '没有前置依赖，开始后由 Agent 领取'
        : `依赖已满足 · 排队第 ${item.queue}${frontier.items.some((i) => i.kind === 'running') ? '，等当前尝试结束' : ''}`;
  }
};

export const FrontierList = memo<FrontierListProps>(
  ({ state, frontier, hotId, freshIds, onHover, onSelect, actions }) => {
    const { styles, cx } = useStyles();
    const { styles: shared } = useSharedStyles();
    const { goal } = state;
    const [rejectFor, setRejectFor] = useState<string | null>(null);
    const [comment, setComment] = useState('');
    const [budget, setBudget] = useState<number>((goal.maxTotalCost ?? 0) + 5);
    const paused = goal.status === 'paused';

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
                        e.stopPropagation();
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
                    e.stopPropagation();
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
                  e.stopPropagation();
                  setRejectFor(n.id);
                }}
              >
                还不够
              </Button>
              <Button
                type="primary"
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
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
                onClick={(e) => e.stopPropagation()}
              />
              <Button
                type="primary"
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
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
                e.stopPropagation();
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
            <>
              <ActionIcon
                icon={Pencil}
                size="small"
                title="编辑这项 Work"
                className={cx('row-actions', styles.hoverActions)}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(n.id, true);
                }}
              />
              <Text fontSize={12} className={cx(shared.muted, shared.mono)}>
                {item.queue ? `#${item.queue}` : ''}
              </Text>
            </>
          );
      }
    };

    const stateTone = (item: FrontierItem) =>
      item.rank === 0
        ? item.kind === 'stale'
          ? 'danger'
          : 'warning'
        : item.kind === 'running' && !paused
          ? 'info'
          : 'secondary';

    return (
      <Flexbox gap={8}>
        <Flexbox horizontal justify="space-between" align="baseline">
          <Flexbox horizontal gap={8} align="baseline">
            <Text fontSize={16} weight={600}>
              接下来
            </Text>
            <Text fontSize={12} className={shared.muted}>
              {goal.status === 'planning'
                ? '开始后 Agent 按优先级逐项领取'
                : `${frontier.needsYou > 0 ? `${frontier.needsYou} 项需要你 · ` : ''}${frontier.items.length} 项能推进`}
            </Text>
          </Flexbox>
          <Button size="small" type="text" icon={<Icon icon={Plus} />}>
            添加 Work
          </Button>
        </Flexbox>

        <div className={shared.list}>
          <Block variant="borderless" gap={0} padding={2}>
            {frontier.items.length === 0 && (
              <Flexbox padding={12} gap={2}>
                <Text weight={500}>
                  {goal.status === 'achieved'
                    ? '没有需要推进的了，Goal 已达成'
                    : '当前没有可推进的节点'}
                </Text>
                <Text fontSize={12} type="secondary">
                  {goal.status === 'achieved'
                    ? '结论都在下面的图里；可以基于任何结论再开一条新的 Work。'
                    : '所有节点都在等待或已终态。'}
                </Text>
              </Flexbox>
            )}
            {frontier.items.map((item, i) => {
              const n = item.node;
              const hot = hotId === n.id;
              const stateText =
                item.kind === 'gate'
                  ? '等你决定'
                  : item.kind === 'acceptance'
                    ? '等你确认'
                    : item.kind === 'budget'
                      ? '需要你'
                      : nodeStateText(goal, n, frontier);
              return (
                <Fragment key={item.key}>
                  {i > 0 && <Divider dashed style={{ margin: 0 }} />}
                  <Block
                    clickable
                    padding={12}
                    className={cx(styles.row, hot && styles.rowHot)}
                    onClick={() => onSelect(n.id)}
                    onMouseEnter={() => onHover(n.id)}
                    onMouseLeave={() => onHover(null)}
                  >
                    <Flexbox horizontal gap={12} align="center">
                      <div className={styles.glyph}>
                        <Glyph item={item} paused={paused} />
                      </div>
                      <Flexbox gap={2} flex={1} style={{ minWidth: 0 }}>
                        <Flexbox horizontal gap={8} align="center">
                          <Text weight={500} ellipsis style={{ minWidth: 0 }}>
                            {rowTitle(state, item)}
                          </Text>
                          <Text fontSize={12} type={stateTone(item)} style={{ flexShrink: 0 }}>
                            {stateText}
                          </Text>
                        </Flexbox>
                        <Text ellipsis className={styles.second}>
                          {secondLine(state, item, frontier)}
                        </Text>
                      </Flexbox>
                      <Flexbox horizontal gap={8} align="center" style={{ flexShrink: 0 }}>
                        {rightCluster(item)}
                      </Flexbox>
                    </Flexbox>
                    {rejectFor === n.id && (
                      <Flexbox
                        gap={8}
                        style={{ marginTop: 10, paddingLeft: 28 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <TextArea
                          autoFocus
                          placeholder="哪里不够？会作为下一轮的输入"
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          autoSize={{ minRows: 2, maxRows: 4 }}
                        />
                        <Flexbox horizontal gap={8} justify="flex-end">
                          <Button size="small" onClick={() => setRejectFor(null)}>
                            取消
                          </Button>
                          <Button
                            size="small"
                            type="primary"
                            disabled={!comment.trim()}
                            onClick={() => {
                              actions.reject(comment);
                              setRejectFor(null);
                            }}
                          >
                            带反馈再来一轮
                          </Button>
                        </Flexbox>
                      </Flexbox>
                    )}
                  </Block>
                </Fragment>
              );
            })}
          </Block>
          {frontier.blocked.length > 0 && (
            <>
              <Divider dashed style={{ margin: 0 }} />
              <Flexbox horizontal gap={6} align="center" wrap="wrap" className={styles.blocked}>
                <Icon icon={Clock} size={12} />
                <span>还有 {frontier.blocked.length} 项在等依赖：</span>
                {frontier.blocked.map((b, i) => (
                  <span
                    key={b.key}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => onHover(b.node.id)}
                    onMouseLeave={() => onHover(null)}
                    onClick={() => onSelect(b.node.id, true)}
                  >
                    <u>{b.node.title}</u>（等{b.blockers.map((x) => x.title.slice(0, 8)).join('、')}
                    …）{i < frontier.blocked.length - 1 ? '、' : ''}
                  </span>
                ))}
              </Flexbox>
            </>
          )}
        </div>
      </Flexbox>
    );
  },
);

export type { GoalNode };
