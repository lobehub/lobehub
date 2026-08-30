import { buildGoalTraceRollup } from './rollup';
import type { GoalAdvanceSnapshot, GoalTickSnapshot, GoalTrajectory } from './types';

const pad = (value: string | number, width: number): string => String(value).padEnd(width);

const duration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
};

const clock = (at: number): string => new Date(at).toISOString().slice(11, 19);

const OUTCOME_GLYPH: Record<string, string> = {
  achieved: '★',
  advanced: '→',
  failed: '✗',
  no_progress: '·',
  waiting_external: '⋯',
  waiting_human: '⏸',
};

/** One line per tick, nested under the advance that ran it. */
const renderTick = (tick: GoalTickSnapshot, last: boolean): string => {
  const branch = pad(tick.branch, 20);
  const chosen = tick.chosenNodeId ? ` ${tick.chosenNodeId.slice(0, 8)}` : '';
  const others = tick.candidates.length > 1 ? ` (+${tick.candidates.length - 1} eligible)` : '';
  return `  ${last ? '└─' : '├─'} ${OUTCOME_GLYPH[tick.outcome] ?? '?'} ${branch}${chosen}${others}  ${tick.message}`;
};

const renderAdvance = (advance: GoalAdvanceSnapshot): string => {
  const head = [
    `#${pad(advance.seq, 4)}`,
    pad(advance.trigger, 8),
    pad(clock(advance.startedAt), 9),
    pad(duration(advance.durationMs), 7),
    `${advance.ticks.length} tick${advance.ticks.length === 1 ? '' : 's'}`,
    advance.childOperationIds?.length ? `→ ${advance.childOperationIds.join(', ')}` : '',
    advance.error ? `!! ${advance.error.message}` : '',
  ]
    .filter(Boolean)
    .join('  ');

  const ticks = advance.ticks.map((tick, index) =>
    renderTick(tick, index === advance.ticks.length - 1),
  );
  return [head, ...ticks].join('\n');
};

/** The whole run: what it cost, where it went, and how it ended. */
export const renderGoalTrajectory = (trajectory: GoalTrajectory): string => {
  const rollup = buildGoalTraceRollup(trajectory);
  const end = trajectory.completedAt ?? Date.now();

  const bucket = (counts: Record<string, number>) =>
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => `${key}=${count}`)
      .join(' ') || '—';

  const header = [
    `Goal      ${trajectory.goalId}  ${trajectory.title}`,
    `Status    ${trajectory.completionReason ?? 'in flight'}   ${duration(end - trajectory.startedAt)}`,
    `Advances  ${rollup.advancesTotal} (${rollup.ticksTotal} ticks)   by trigger: ${bucket(rollup.advancesByTrigger)}`,
    `Outcomes  ${bucket(rollup.advancesByOutcome)}`,
    `Graph     ${rollup.nodesTotal} nodes · ${rollup.tasksCompleted} tasks done · ${rollup.findingsTotal} findings`,
    `Human     ${rollup.gatesOpened} gate(s), ${duration(rollup.humanWaitingMs)} waiting`,
    `Ops       ${rollup.operationsTotal} operation(s) — lh trace op inspect <opId> to go deeper`,
  ].join('\n');

  return [header, '', ...trajectory.advances.map((advance) => renderAdvance(advance))].join('\n');
};

/**
 * One advance in full: the decision surface of each of its ticks, including the
 * candidates it passed over — which is what the summary view cannot show and
 * what any question about "why not that node" needs.
 */
export const renderGoalAdvanceDetail = (trajectory: GoalTrajectory, seq: number): string => {
  const advance = trajectory.advances.find((item) => item.seq === seq);
  if (!advance) return `No advance #${seq} in ${trajectory.goalId}`;

  const lines = [
    `Advance #${advance.seq}  trigger=${advance.trigger}  ${clock(advance.startedAt)}  ${duration(advance.durationMs)}`,
  ];
  if (advance.error) lines.push(`Error: ${advance.error.type} — ${advance.error.message}`);

  for (const tick of advance.ticks) {
    lines.push(
      '',
      `  tick ${tick.index}  ${tick.branch} → ${tick.outcome}`,
      `    ${tick.message}`,
      `    graph: ${tick.graphShape.nodesTotal} nodes, tasks ${tick.graphShape.tasksReady} ready / ${tick.graphShape.tasksBlocked} blocked / ${tick.graphShape.tasksCompleted} done, ${tick.graphShape.gatesPending} gate(s) pending`,
    );

    if (tick.budget) {
      const limits = [
        tick.budget.maxRounds == null
          ? 'rounds ∞'
          : `rounds ${tick.budget.runs}/${tick.budget.maxRounds}`,
        tick.budget.maxTotalCost == null
          ? 'cost ∞'
          : `cost $${tick.budget.totalCost.toFixed(4)}/$${tick.budget.maxTotalCost}`,
      ].join('  ');
      lines.push(`    budget: ${limits}`);
    }

    if (tick.frontierTask) {
      const error = tick.frontierTask.error ? ` — ${tick.frontierTask.error}` : '';
      lines.push(
        `    task: ${tick.frontierTask.identifier ?? tick.frontierTask.id} ${tick.frontierTask.status}${error}`,
      );
    }

    if (tick.candidates.length > 0) {
      lines.push('    frontier:');
      for (const candidate of tick.candidates) {
        const mark = candidate.nodeId === tick.chosenNodeId ? '▸' : ' ';
        const blocked = candidate.blockedBy.length
          ? ` blocked by ${candidate.blockedBy.map((id) => id.slice(0, 8)).join(', ')}`
          : '';
        lines.push(
          `      ${mark} ${candidate.nodeId.slice(0, 8)} p${candidate.priority} ${candidate.status} ${candidate.title}${blocked}`,
        );
      }
    }

    for (const effect of tick.effects) {
      const target = effect.targetId ? ` ${effect.targetId}` : '';
      const operation = effect.operationId ? ` op=${effect.operationId}` : '';
      const detail = effect.detail ? ` (${effect.detail})` : '';
      lines.push(`    effect: ${effect.type}${target}${operation}${detail}`);
    }
  }

  return lines.join('\n');
};
