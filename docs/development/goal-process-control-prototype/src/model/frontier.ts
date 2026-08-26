// Frontier projection — what the coordinator would consider next — and the plain-word states the
// surface shows. Pure functions over GoalState; a production version reads the graph snapshot.

import type { GoalInfo, GoalNode, GoalState } from '../types';
import { ago, clock, min } from './format';

export const isStale = (goal: GoalInfo, n: GoalNode) =>
  n.kind === 'work' &&
  n.status === 'active' &&
  !n.delivered &&
  !!n.lastActivity &&
  clock.now - n.lastActivity > min(goal.leaseTimeoutMin);

export type FrontierItemKind = 'gate' | 'budget' | 'acceptance' | 'stale' | 'running' | 'ready';

export interface FrontierItem {
  key: string;
  kind: FrontierItemKind;
  node: GoalNode;
  /** 0 = needs you, 1 = running, 2 = ready */
  rank: number;
  /** Ready items: 1-based order the coordinator would pick them in (it dispatches one per tick). */
  order?: number;
}

export interface BlockedItem {
  key: string;
  node: GoalNode;
  blockers: GoalNode[];
}

export interface Frontier {
  items: FrontierItem[];
  blocked: BlockedItem[];
  needsYou: number;
}

/**
 * Frontier = nodes that can change state under current conditions:
 * pending decisions addressed to the user, active Work, and proposed Work whose `depends_on` are all
 * resolved. Blocked Work is folded, not listed.
 */
export const computeFrontier = (state: GoalState): Frontier => {
  const byId = Object.fromEntries(state.nodes.map((n) => [n.id, n]));
  const items: FrontierItem[] = [];
  const blocked: BlockedItem[] = [];
  for (const n of state.nodes) {
    if (n.kind === 'decision' && n.status === 'waiting' && n.authority === 'user') {
      items.push({ key: n.id, kind: 'gate', node: n, rank: 0 });
      continue;
    }
    if (n.kind !== 'work') continue;
    if (n.delivered) {
      // verifier passed; the human accept is an action on this Work, not a node
      items.push({ key: `accept:${n.id}`, kind: 'acceptance', node: n, rank: 0 });
      continue;
    }
    if (n.status === 'active') {
      if (isStale(state.goal, n) && state.goal.status !== 'paused')
        items.push({ key: n.id, kind: 'stale', node: n, rank: 0 });
      else items.push({ key: n.id, kind: 'running', node: n, rank: 1 });
      continue;
    }
    if (n.status === 'proposed') {
      const blockers = (n.dependsOn ?? [])
        .map((id) => byId[id])
        .filter((d) => d && d.status !== 'resolved');
      if (blockers.length) blocked.push({ key: n.id, node: n, blockers });
      else items.push({ key: n.id, kind: 'ready', node: n, rank: 2 });
    }
  }
  if (state.goal.status === 'paused' && state.goal.pauseCause === 'cost') {
    // budget top-up is asked on the Work that was running, not on a new node
    const target =
      state.nodes.find((n) => n.kind === 'work' && n.status === 'active') ?? state.nodes[0];
    items.push({ key: `budget:${target.id}`, kind: 'budget', node: target, rank: 0 });
  }
  items.sort((a, b) => a.rank - b.rank || (b.node.priority ?? 0) - (a.node.priority ?? 0));
  let q = 0;
  for (const it of items) if (it.kind === 'ready') it.order = ++q;
  return { items, blocked, needsYou: items.filter((i) => i.rank === 0).length };
};

export const goalSentence = (goal: GoalInfo, frontier: Frontier) => {
  switch (goal.status) {
    case 'planning':
      return '初始方案已生成，还没有开始';
    case 'running': {
      const stale = frontier.items.find((i) => i.kind === 'stale');
      if (stale)
        return `运行中，但已失联 · 最近动作 ${ago(clock.now - (stale.node.lastActivity ?? clock.now))}`;
      return `运行中 · 最近动作 ${ago(clock.now - (goal.lastActivity ?? clock.now))}`;
    }
    case 'verifying':
      return '整体验收中';
    case 'review':
      return frontier.items.some((i) => i.kind === 'gate')
        ? `等你决定 · 已等待 ${ago(clock.now - (goal.lastActivity ?? clock.now)).replace('前', '')}`
        : '验收通过，等你确认';
    case 'paused':
      return goal.pauseCause === 'cost'
        ? '已暂停 · 费用预算用完'
        : goal.pauseCause === 'rounds'
          ? '已暂停 · 尝试次数用完'
          : '已由你暂停';
    case 'achieved':
      return `已达成 · ${ago(clock.now - (goal.completedAt ?? clock.now))}`;
    case 'failed':
      return '未达成';
    case 'canceled':
      return '已取消';
  }
};

export const nodeStateText = (goal: GoalInfo, n: GoalNode, frontier: Frontier) => {
  if (n.kind === 'decision')
    return n.status === 'waiting'
      ? '等你决定'
      : n.authority === 'agent'
        ? 'Agent 已决定'
        : '你已决定';
  if (n.kind === 'finding') return `结论 · ${ago(clock.now - (n.at ?? clock.now))}`;
  if (n.kind === 'problem') return n.status === 'resolved' ? '已回答' : '待回答';
  if (n.delivered) return '验收通过，等你确认';
  switch (n.status) {
    case 'resolved':
      return '完成';
    case 'retired':
      return '已放弃';
    case 'waiting':
      return '等你决定';
    case 'active':
      if (goal.status === 'paused') return '已停止';
      if (isStale(goal, n)) return '失联，等待回收';
      return `进行中 · 第 ${(n.attempts?.length ?? 0) + 1} 次尝试`;
    case 'proposed': {
      const b = frontier.blocked.find((x) => x.node.id === n.id);
      if (b) return `等待「${b.blockers[0].title}」`;
      return goal.status === 'planning' ? '待开始' : '可以开始';
    }
    default:
      return n.status;
  }
};

export const countAttempts = (state: GoalState) =>
  state.nodes.reduce(
    (a, n) => a + (n.attempts?.filter((x) => x.outcome !== 'abandoned').length ?? 0),
    0,
  );
