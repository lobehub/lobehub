// Activity model — the feed is a per-node work record, not a raw event log.
//
// A Goal produces many runtime events (dispatch, evidence submission, verifier verdicts, lease
// renewals). Most of them belong *inside* a task: the verifier judging attempt #2 of "从零训练" is
// part of that task's story, not a separate line in the Goal's history. So the feed shows one entry
// per node — what that node did, by whom, how it ended — and folds the per-attempt detail under it.
//
// Goal-level entries (things that are not about a single node) stay as their own rows:
// create · pause · resume · budget · comment · achieved.
//
//   Source (production)                    → where it lands
//   goal_events created (graph seeded)     → goal row 「生成初始方案」
//   coordinator runTask / recovery         → the node's attempt list
//   task topic last line + heartbeat       → the node's live line while running
//   verify run passed / failed / errored   → the attempt's outcome (never its own row)
//   lease abandoned                        → the attempt's outcome (失联回收)
//   goal_nodes finding created             → the node's 结论 line
//   decisions opened / resolved            → the node's 人工参与 + the decision node's own entry
//   goal paused / resumed / setBudget      → goal row
//   task comment                           → goal row
//   goal achieved                          → goal row

import type { LucideIcon } from 'lucide-react';
import { Coins, MessageSquare, Pause, Play, Sparkles, Trophy } from 'lucide-react';

import type { GoalNode, GoalState } from '../types';

export type GoalEventKind = 'create' | 'pause' | 'resume' | 'budget' | 'comment' | 'achieved';

export const GOAL_EVENT_META: Record<
  GoalEventKind,
  { icon: LucideIcon; tone: 'neutral' | 'ok' | 'warn' }
> = {
  create: { icon: Sparkles, tone: 'neutral' },
  pause: { icon: Pause, tone: 'warn' },
  resume: { icon: Play, tone: 'neutral' },
  budget: { icon: Coins, tone: 'warn' },
  comment: { icon: MessageSquare, tone: 'neutral' },
  achieved: { icon: Trophy, tone: 'ok' },
};

/** Per-node record: one row in the feed, with its attempts folded underneath. */
export interface NodeRecord {
  node: GoalNode;
  /** Newest timestamp on this node — sorts the feed. */
  t: number;
  /** Who is (or was) doing the work. */
  actor?: string;
  /** One plain sentence: what state this node reached. */
  summary: string;
  /** Findings this node produced. */
  findings: GoalNode[];
}

export interface GoalRecord {
  kind: GoalEventKind;
  t: number;
  who: string;
  text: string;
}

const lastAttemptEnd = (n: GoalNode) => (n.attempts?.length ? n.attempts.at(-1)!.ended : undefined);

const summarize = (n: GoalNode, state: GoalState): string => {
  const attempts = n.attempts ?? [];
  const real = attempts.filter((a) => a.outcome !== 'abandoned').length;
  const abandoned = attempts.filter((a) => a.outcome === 'abandoned').length;
  const suffix = abandoned > 0 ? `，另有 ${abandoned} 次失联回收` : '';
  if (n.kind === 'decision') return n.status === 'waiting' ? '等你决定' : (n.body ?? '已决定');
  if (n.kind === 'problem') return n.status === 'resolved' ? '已被结论回答' : '待回答';
  switch (n.status) {
    case 'resolved':
      return `完成 · ${real} 次尝试${suffix}`;
    case 'retired':
      return `已放弃 · ${real} 次尝试${suffix}`;
    case 'waiting':
      return `${real} 次尝试都没通过验证，等你决定${suffix}`;
    case 'active':
      if (n.delivered) return '验收通过，等你确认';
      return `进行中 · 第 ${attempts.length + 1} 次尝试${suffix}`;
    default:
      return state.goal.status === 'planning' ? '待开始' : '还没开始';
  }
};

/** Nodes that have actually done something, newest first, plus the goal-level rows. */
export const buildRecords = (state: GoalState) => {
  const findingsBySource = new Map<string, GoalNode[]>();
  for (const f of state.nodes) {
    if (f.kind !== 'finding' || !f.from) continue;
    findingsBySource.set(f.from, [...(findingsBySource.get(f.from) ?? []), f]);
  }

  const nodes: NodeRecord[] = state.nodes
    .filter(
      (n) =>
        (n.kind === 'work' && (n.attempts?.length || n.status !== 'proposed')) ||
        (n.kind === 'decision' && n.status !== 'proposed'),
    )
    .map((n) => ({
      node: n,
      t: Math.max(
        n.at ?? 0,
        n.lastActivity ?? 0,
        lastAttemptEnd(n) ?? 0,
        n.humanTouches?.at(-1)?.t ?? 0,
      ),
      actor: n.task?.agent,
      summary: summarize(n, state),
      findings: findingsBySource.get(n.id) ?? [],
    }))
    .sort((a, b) => b.t - a.t);

  return nodes;
};
