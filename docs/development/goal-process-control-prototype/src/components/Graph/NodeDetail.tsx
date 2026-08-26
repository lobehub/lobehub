import { Button, Flexbox, Icon, Input, InputNumber, Tag, Text, TextArea } from '@lobehub/ui';
import { Checkbox } from 'antd';
import { createStyles } from 'antd-style';
import { ArrowUp, ExternalLink, Lightbulb, Play, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';

import { ago, clock, min, usd } from '../../model/format';
import { type Frontier, nodeStateText } from '../../model/frontier';
import type { EdgeKind, GoalState } from '../../types';
import { KIND_CN, KindDot, NewTag, useSharedStyles } from '../shared';

// Content of the right-side panel (Drawer): what a node is, where it came from, who touched it, and —
// for a not-yet-started task — an editor.

const useStyles = createStyles(({ css, token }) => ({
  ledgerLine: css`
    padding-block: 6px;
    border-block-start: 1px dashed ${token.colorBorderSecondary};

    &:first-of-type {
      border-block-start: none;
    }
  `,
  label: css`
    font-size: 12px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
  `,
}));

const REL: Record<EdgeKind, string> = {
  decomposes: '拆出',
  depends_on: '依赖',
  investigates: '调查',
  produces: '产出',
  supports: '支持',
  contradicts: '反驳',
  leads_to: '导向',
};

interface NodeDetailProps {
  state: GoalState;
  frontier: Frontier;
  id: string;
  editing?: boolean;
  onSelect: (id: string) => void;
  onStart?: (id: string) => void;
}

export const NodeDetailTitle = memo<{ state: GoalState; frontier: Frontier; id: string }>(
  ({ state, frontier, id }) => {
    const { styles: shared } = useSharedStyles();
    const n = state.nodes.find((x) => x.id === id);
    if (!n) return null;
    return (
      <Flexbox horizontal gap={8} align="center" style={{ minWidth: 0 }}>
        <KindDot kind={n.kind} />
        <Text fontSize={12} className={shared.muted}>
          {KIND_CN[n.kind]}
        </Text>
        <Text weight={600} ellipsis style={{ minWidth: 0 }}>
          {n.title}
        </Text>
        <Text fontSize={12} type="secondary" style={{ flexShrink: 0 }}>
          {nodeStateText(state.goal, n, frontier)}
          {n.cost ? ` · ${usd(n.cost)}` : ''}
        </Text>
      </Flexbox>
    );
  },
);

export const NodeDetail = memo<NodeDetailProps>(
  ({ state, frontier, id, editing, onSelect, onStart }) => {
    const { styles, cx } = useStyles();
    const { styles: shared } = useSharedStyles();
    const n = state.nodes.find((x) => x.id === id);
    const [title, setTitle] = useState(n?.title ?? '');
    const [desc, setDesc] = useState(n?.description ?? '');
    const [prio, setPrio] = useState(n?.priority ?? 0);
    const [deps, setDeps] = useState<string[]>(n?.dependsOn ?? []);
    if (!n) return null;
    const { goal } = state;
    const byId = (x: string) => state.nodes.find((m) => m.id === x);
    const editable = n.kind === 'work' && n.status === 'proposed';
    const producer = n.kind === 'finding' && n.from ? byId(n.from) : undefined;
    const producingAttempt = producer?.attempts?.find((a) => a.outcome === 'passed');
    const otherWorks = state.nodes.filter((w) => w.kind === 'work' && w.id !== n.id && !w.terminal);

    return (
      <Flexbox gap={16}>
        {editable && (
          <Flexbox gap={10}>
            <Flexbox gap={4}>
              <span className={styles.label}>标题</span>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Flexbox>
            <Flexbox gap={4}>
              <span className={styles.label}>要做什么 · 交付什么</span>
              <TextArea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                autoSize={{ minRows: 3, maxRows: 8 }}
                placeholder="写清允许的产出与完成标准，会进入负责人 Task 的指令"
              />
            </Flexbox>
            <Flexbox gap={4}>
              <span className={styles.label}>优先级</span>
              <InputNumber
                value={prio}
                onChange={(v) => setPrio(Number(v ?? 0))}
                style={{ width: 120 }}
              />
            </Flexbox>
            <Flexbox gap={4}>
              <span className={styles.label}>先等这些完成（依赖）</span>
              <Flexbox gap={2}>
                {otherWorks.map((w) => (
                  <Checkbox
                    key={w.id}
                    checked={deps.includes(w.id)}
                    onChange={(e) =>
                      setDeps(e.target.checked ? [...deps, w.id] : deps.filter((d) => d !== w.id))
                    }
                  >
                    <Text fontSize={13}>{w.title}</Text>
                  </Checkbox>
                ))}
              </Flexbox>
            </Flexbox>
            <Flexbox horizontal gap={8} align="center" wrap="wrap">
              <Button type="primary" size="small">
                保存 <NewTag title="没有 goal.updateNode；今天只能 addNode / addEdge" />
              </Button>
              <Button size="small" icon={<Icon icon={ArrowUp} />}>
                先做这个 <NewTag title="调优先级 = updateNode，未建模" />
              </Button>
              {goal.status !== 'planning' && onStart && (
                <Button size="small" icon={<Icon icon={Play} />} onClick={() => onStart(n.id)}>
                  现在开始 <NewTag title="并行派发：coordinator 每次 tick 只派一个节点（串行）" />
                </Button>
              )}
              <Button size="small" danger icon={<Icon icon={Trash2} />}>
                移除 <NewTag title="retire 一个未开始的任务：未建模" />
              </Button>
            </Flexbox>
          </Flexbox>
        )}

        {!editable && n.description && <Text fontSize={13}>{n.description}</Text>}
        {n.body && <Text fontSize={13}>{n.body}</Text>}

        {n.kind === 'finding' && producer && (
          <Flexbox gap={4}>
            <span className={styles.label}>来源</span>
            <Flexbox horizontal gap={8} align="center" wrap="wrap">
              <KindDot kind={producer.kind} />
              <Text
                fontSize={13}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelect(producer.id)}
              >
                {producer.title}
              </Text>
              {producingAttempt && (
                <>
                  <Text fontSize={12} type="secondary">
                    第 {producingAttempt.n} 次尝试 · {producingAttempt.taskId} ·{' '}
                    {ago(clock.now - producingAttempt.ended)}
                  </Text>
                  <Button type="text" size="small" icon={<Icon icon={ExternalLink} />}>
                    打开这次运行
                  </Button>
                  <Tag size="small">证据版本 #1</Tag>
                </>
              )}
            </Flexbox>
          </Flexbox>
        )}

        {!!n.humanTouches?.length && (
          <Flexbox gap={4}>
            <span className={styles.label}>人工参与</span>
            {n.humanTouches.map((t, i) => (
              <Flexbox key={i} horizontal gap={8} align="baseline">
                <Text
                  fontSize={12}
                  className={cx(shared.muted, shared.mono)}
                  style={{ flexShrink: 0 }}
                >
                  {ago(clock.now - t.t)}
                </Text>
                <Text fontSize={13}>{t.text}</Text>
              </Flexbox>
            ))}
          </Flexbox>
        )}

        {n.kind === 'work' && n.task && (
          <Flexbox gap={4}>
            <span className={styles.label}>负责人 Task</span>
            <Flexbox horizontal gap={8} align="center">
              <Text fontSize={13} className={shared.mono}>
                {n.task.id}
              </Text>
              <Text fontSize={13}>{n.task.agent}</Text>
              <Button type="text" size="small" icon={<Icon icon={ExternalLink} />}>
                打开会话
              </Button>
            </Flexbox>
            {n.lastLine && <div className={shared.evidence}>{n.lastLine}</div>}
          </Flexbox>
        )}

        {n.kind === 'work' && !!n.attempts?.length && (
          <Flexbox gap={2}>
            <span className={styles.label}>尝试记录</span>
            {n.attempts.map((a) => (
              <Flexbox key={a.n} gap={2} className={styles.ledgerLine}>
                <Flexbox horizontal gap={8} align="center">
                  <Text fontSize={12} weight={600} style={{ flexShrink: 0 }}>
                    第 {a.n} 次
                  </Text>
                  <Text
                    fontSize={12}
                    type={
                      a.outcome === 'passed'
                        ? 'success'
                        : a.outcome === 'failed'
                          ? 'danger'
                          : 'secondary'
                    }
                    style={{ flexShrink: 0 }}
                  >
                    {a.outcome === 'passed' ? '通过' : a.outcome === 'failed' ? '未通过' : '失联'}
                  </Text>
                  <Text
                    fontSize={12}
                    className={cx(shared.muted, shared.mono)}
                    style={{ flexShrink: 0 }}
                  >
                    {Math.round((a.ended - a.started) / min(1))} 分钟 · {usd(a.cost)}
                  </Text>
                  <Button
                    type="text"
                    size="small"
                    icon={<Icon icon={ExternalLink} />}
                    style={{ marginLeft: 'auto' }}
                  />
                </Flexbox>
                <Text fontSize={12} type="secondary">
                  {a.reason}
                </Text>
              </Flexbox>
            ))}
          </Flexbox>
        )}

        <Flexbox gap={4}>
          <span className={styles.label}>在图里的位置</span>
          {state.edges
            .filter(([a, b]) => a === id || b === id)
            .map(([a, b, kind]) => {
              const other = a === id ? b : a;
              const o = byId(other);
              if (!o) return null;
              return (
                <Flexbox
                  key={`${a}${b}${kind}`}
                  horizontal
                  gap={6}
                  align="center"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelect(other)}
                >
                  <KindDot kind={o.kind} />
                  <Text fontSize={12} type="secondary">
                    {a === id ? `${REL[kind]} → ${o.title}` : `${o.title} → ${REL[kind]}这里`}
                  </Text>
                </Flexbox>
              );
            })}
        </Flexbox>

        {n.kind === 'finding' && (
          <Flexbox horizontal gap={8} align="center">
            <Button size="small" icon={<Icon icon={Lightbulb} />}>
              基于这个结论开一条任务
            </Button>
            <Text fontSize={12} className={shared.muted}>
              = addNode + leads_to
            </Text>
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);
