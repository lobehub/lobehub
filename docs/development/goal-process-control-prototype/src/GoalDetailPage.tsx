import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { Activity } from './components/Activity';
import { Contract } from './components/Contract';
import { Findings } from './components/Findings';
import { FrontierList } from './components/Frontier/FrontierList';
import { GoalHeader } from './components/GoalHeader';
import { Graph } from './components/Graph/Graph';
import { NodeDetail } from './components/Graph/NodeDetail';
import { useSharedStyles } from './components/shared';
import { STEPS, buildStep } from './data/steps';
import { clock, usd } from './model/format';
import { computeFrontier, isStale } from './model/frontier';
import type { GoalState } from './types';

// The page body, in TaskDetailPage order: header → frontier → graph (+ node panel) → findings →
// contract → activity. State here is the replayed step plus local optimistic mutations from the
// actions; production reads the goal graph snapshot and calls goal.* / acceptance.* procedures.

const useStyles = createStyles(({ css }) => ({
  column: css`
    width: min(960px, 100%);
    margin-block: 0;
    margin-inline: auto;
    padding-block: 24px 120px;
    padding-inline: 16px;
  `,
  wide: css`
    width: 100%;
    max-width: 1400px;
  `,
}));

const Section = memo<{
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}>(({ title, count, defaultOpen = false, children }) => {
  const { styles } = useSharedStyles();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Flexbox gap={8}>
      <Flexbox
        horizontal
        gap={6}
        align="center"
        className={styles.sectionHead}
        onClick={() => setOpen(!open)}
      >
        <Icon icon={open ? ChevronDown : ChevronRight} size={14} />
        <Text weight={600}>{title}</Text>
        {count !== undefined && (
          <Text fontSize={12} className={styles.muted}>
            {count}
          </Text>
        )}
      </Flexbox>
      {open && children}
    </Flexbox>
  );
});

export const GoalDetailPage = memo<{ step: number }>(({ step }) => {
  const { styles, cx } = useStyles();
  const [state, setState] = useState<GoalState>(() => buildStep(step));
  const [hotId, setHotId] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ id: string; edit?: boolean } | null>(null);
  const [wide, setWide] = useState(false);
  const frontier = useMemo(() => computeFrontier(state), [state]);
  const freshIds = useMemo(() => new Set(STEPS[step].fresh), [step]);
  const now = clock.now;
  const select = (id: string, edit?: boolean) =>
    setSelected(selected?.id === id && !edit ? null : { id, edit });
  const push = (e: GoalState['log'][number]) => setState((s) => ({ ...s, log: [...s.log, e] }));
  const patch = (id: string, p: Partial<GoalState['nodes'][number]>) =>
    setState((s) => ({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) }));

  const actions = {
    start: () => {
      setState((s) => ({
        ...s,
        goal: { ...s.goal, status: 'running', startedAt: now, lastActivity: now },
        nodes: s.nodes.map((n) =>
          n.id === 'W1'
            ? {
                ...n,
                status: 'active',
                lastActivity: now,
                task: { id: 'T-90', agent: 'Kimi Code' },
                lastLine: '正在准备工作目录…',
              }
            : n,
        ),
      }));
      push({ t: now, kind: 'resume', who: '你', text: '开始执行' });
    },
    pause: () => {
      setState((s) => ({ ...s, goal: { ...s.goal, status: 'paused', pauseCause: 'user' } }));
      push({ t: now, kind: 'pause', who: '你', text: '暂停：不再开始新的尝试' });
    },
    resume: () => {
      setState((s) => ({
        ...s,
        goal: {
          ...s.goal,
          status: s.decision ? 'review' : 'running',
          pauseCause: undefined,
          lastActivity: now,
        },
      }));
      push({ t: now, kind: 'resume', who: '你', text: '继续' });
    },
    setBudget: ({
      rounds,
      cost,
      perWork,
    }: {
      rounds: number | null;
      cost: number | null;
      perWork: number;
    }) => {
      setState((s) => ({
        ...s,
        goal: { ...s.goal, maxRounds: rounds, maxTotalCost: cost, maxAttemptsPerWork: perWork },
      }));
      push({
        t: now,
        kind: 'budget',
        who: '你',
        text: `更新预算：费用 ${cost != null ? usd(cost) : '不限'} · 尝试 ${rounds ?? '不限'} · 单项 ${perWork}`,
      });
    },
    decide: (optionId: string, reason?: string) => {
      const d = state.decision;
      if (!d) return;
      setState((s) => ({
        ...s,
        goal: { ...s.goal, status: 'running', lastActivity: now },
        decision: null,
        nodes: s.nodes.map((n) => {
          if (n.id === d.nodeId)
            return {
              ...n,
              status: 'resolved',
              title: optionId === 'retry' ? '训练两次未通过 → 再试一次' : '训练两次未通过 → 放弃',
              body: reason ? `你的说明：${reason}` : undefined,
              at: now,
            };
          if (n.id === d.workId)
            return optionId === 'retry'
              ? {
                  ...n,
                  status: 'active',
                  lastActivity: now,
                  lastLine: '正在启动下一次尝试…',
                  humanTouches: [
                    ...(n.humanTouches ?? []),
                    {
                      t: now,
                      kind: 'retry',
                      text: `决策门：再试一次${reason ? ` — ${reason}` : ''}`,
                    },
                  ],
                }
              : {
                  ...n,
                  status: 'retired',
                  humanTouches: [
                    ...(n.humanTouches ?? []),
                    { t: now, kind: 'retire', text: '决策门：放弃这项 Work' },
                  ],
                };
          return n;
        }),
      }));
      push({
        t: now,
        kind: 'decision',
        who: '你',
        text: optionId === 'retry' ? '决定：再试一次' : '决定：放弃这项 Work',
        nodeId: d.nodeId,
      });
    },
    accept: () => {
      const target = state.nodes.find((n) => n.delivered);
      setState((s) => ({
        ...s,
        goal: { ...s.goal, status: 'achieved', completedAt: now },
        nodes: s.nodes.map((n) =>
          n.delivered
            ? {
                ...n,
                delivered: false,
                status: 'resolved',
                humanTouches: [
                  ...(n.humanTouches ?? []),
                  { t: now, kind: 'accept', text: '确认验收：Goal 达成' },
                ],
              }
            : n,
        ),
      }));
      push({
        t: now,
        kind: 'achieved',
        who: '你',
        text: '确认完成：Goal 达成',
        nodeId: target?.id,
      });
    },
    reject: (comment: string) => {
      const target = state.nodes.find((n) => n.delivered);
      setState((s) => ({
        ...s,
        goal: { ...s.goal, status: 'running', lastActivity: now },
        nodes: s.nodes.map((n) =>
          n.delivered
            ? {
                ...n,
                delivered: false,
                status: 'active',
                lastActivity: now,
                lastLine: `按你的反馈重新验收：${comment}`,
                humanTouches: [
                  ...(n.humanTouches ?? []),
                  { t: now, kind: 'reject', text: `还不够，再来一轮：${comment}` },
                ],
              }
            : n,
        ),
      }));
      push({
        t: now,
        kind: 'decision',
        who: '你',
        text: `退回并带反馈再来一轮：${comment}`,
        nodeId: target?.id,
      });
    },
    addBudget: (cap: number) => {
      const target = state.nodes.find((n) => n.kind === 'work' && n.status === 'active');
      setState((s) => ({
        ...s,
        goal: {
          ...s.goal,
          status: 'running',
          pauseCause: undefined,
          maxTotalCost: cap,
          lastActivity: now,
        },
        nodes: s.nodes.map((n) =>
          n.id === target?.id
            ? {
                ...n,
                humanTouches: [
                  ...(n.humanTouches ?? []),
                  { t: now, kind: 'budget', text: `预算 → ${usd(cap)}，继续` },
                ],
              }
            : n,
        ),
      }));
      push({
        t: now,
        kind: 'budget',
        who: '你',
        text: `费用上限调整为 ${usd(cap)}，继续`,
        nodeId: target?.id,
      });
    },
    reclaim: () => {
      setState((s) => ({
        ...s,
        goal: { ...s.goal, lastActivity: now },
        nodes: s.nodes.map((n) =>
          isStale(s.goal, n)
            ? {
                ...n,
                attempts: [
                  ...(n.attempts ?? []),
                  {
                    n: (n.attempts?.length ?? 0) + 1,
                    started: (n.lastActivity ?? now) - 20 * 60_000,
                    ended: now,
                    outcome: 'abandoned',
                    cost: 0.3,
                    reason: '执行 Agent 失联，由系统回收；不计入失败次数',
                    taskId: n.task?.id,
                  },
                ],
                lastActivity: now,
                lastLine: '正在重新启动这次尝试…',
              }
            : n,
        ),
      }));
      push({ t: now, kind: 'abandon', who: '系统', text: '回收失联的尝试并重开', nodeId: 'W2' });
    },
    startNode: (id: string) => {
      patch(id, {
        status: 'active',
        lastActivity: now,
        task: { id: 'T-97', agent: 'Kimi Code' },
        lastLine: '正在启动第 1 次尝试…',
      });
      push({ t: now, kind: 'start', who: '你', text: '现在开始（与当前尝试并行）', nodeId: id });
      setSelected(null);
    },
    comment: (text: string) => push({ t: now, kind: 'comment', who: '你', text }),
  };

  const findingsCount = state.nodes.filter((n) => n.kind === 'finding').length;

  return (
    <div className={cx(styles.column, wide && styles.wide)}>
      <Flexbox gap={24}>
        <GoalHeader
          state={state}
          frontier={frontier}
          onStart={actions.start}
          onPause={actions.pause}
          onResume={actions.resume}
          onSetBudget={actions.setBudget}
        />
        <FrontierList
          state={state}
          frontier={frontier}
          hotId={hotId}
          freshIds={freshIds}
          onHover={setHotId}
          onSelect={select}
          actions={actions}
        />
        <Flexbox gap={12}>
          <Graph
            state={state}
            frontier={frontier}
            hotId={hotId}
            selectedId={selected?.id ?? null}
            freshIds={freshIds}
            onHover={setHotId}
            onSelect={(id) => select(id)}
            wide={wide}
            onToggleWide={() => setWide(!wide)}
            isDraft={state.goal.status === 'planning'}
          />
          {selected && (
            <NodeDetail
              key={selected.id}
              state={state}
              frontier={frontier}
              id={selected.id}
              editing={selected.edit}
              onClose={() => setSelected(null)}
              onSelect={(id) => setSelected({ id })}
              onStart={actions.startNode}
            />
          )}
        </Flexbox>
        <Section title="结论" count={findingsCount} defaultOpen={findingsCount > 0}>
          <Findings state={state} hotId={hotId} onHover={setHotId} onSelect={(id) => select(id)} />
        </Section>
        <Section title="目标与验收标准">
          <Contract goal={state.goal} />
        </Section>
        <Section title="活动" count={state.log.length} defaultOpen>
          <Activity
            state={state}
            onHover={setHotId}
            onSelect={(id) => select(id)}
            onComment={actions.comment}
          />
        </Section>
      </Flexbox>
    </div>
  );
});
