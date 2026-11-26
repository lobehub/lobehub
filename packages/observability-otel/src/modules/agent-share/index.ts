import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('server-services-agent-share');

/**
 * Where a shared Agent run ended:
 * - `admission` — refused before the run started (share limits, a revoked share, a dispatch
 *   failure); the Agent never ran
 * - `run`       — the run started and reached a terminal state in the runtime
 */
export type AgentShareRunStage = 'admission' | 'run';

/** `refused` is an admission refusal the visitor can act on (a typed share limit). */
export type AgentShareRunOutcome = 'error' | 'interrupted' | 'refused' | 'success';

/**
 * Terminal results of shared Agent runs, whichever surface the visitor used.
 *
 * Labels (all small closed sets; never a user, share, Agent or operation id):
 * - `stage`: {@link AgentShareRunStage}
 * - `outcome`: {@link AgentShareRunOutcome}
 * - `error_type`: the normalized error type, `none` on success, `Other` for a type outside the
 *   known error taxonomy, `Unknown` when the failure carried no type
 * - `error_attribution`: `user` | `provider` | `harness` | `system` | `none`
 */
export const agentShareRunCounter = meter.createCounter('agent_share_runs_total', {
  description: 'Terminal results of shared Agent runs, by stage, outcome and error type.',
  unit: '{run}',
});
