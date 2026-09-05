// ============================================
// Evolution — tree search over artifact versions
// (`evolution_trees` / `evolution_nodes` tables)
// ============================================

/**
 * What a search tree can be mounted on. Polymorphic with no FK, mirroring
 * `metrics.subjectType`: a Goal Work dispatches a search, but a tree is also
 * runnable standalone (CLI experiments). Existence and ownership of the
 * subject are validated by the service that binds it.
 */
export type EvolutionSubjectType = 'goal' | 'task' | 'standalone';

/**
 * Lifecycle of one search. `stopped` is a deliberate halt (budget, plateau,
 * user); `failed` means the search itself broke, not that candidates scored
 * poorly — failing candidates are normal and live on their nodes.
 */
export type EvolutionTreeStatus = 'pending' | 'running' | 'completed' | 'stopped' | 'failed';

/**
 * One candidate's outcome. A version that crashed, looped, or timed out in the
 * sandbox still enters the tree as `failed` — the search learns as much from
 * where not to go as from where to go, and pruning failures would erase that.
 */
export type EvolutionNodeStatus = 'pending' | 'scored' | 'failed';

/**
 * The programmatic judge: a sandbox command that evaluates one candidate and
 * prints a scalar. This is what lets an iteration cost seconds instead of an
 * agent run — no LLM reads the artifact to decide whether it got better.
 *
 * Convention: **higher is better.** A scorer measuring error reports its
 * negation (the reference implementation's "0 = perfect, more negative =
 * worse" already fits).
 */
export interface EvolutionScorer {
  /** Command run in the sandbox with the candidate artifact in place. */
  command: string;
  /**
   * How the scalar is read from stdout. `last-number` (default) takes the
   * last parseable number; `json` expects a `{"score": n}` object line.
   */
  parse?: 'last-number' | 'json';
  /** Per-candidate wall-clock cap; the sandbox kills and marks `failed` past it. */
  timeoutMs?: number;
}

/** When the search stops on its own. All limits optional; unset = unbounded. */
export interface EvolutionBudget {
  /** Wall-clock cap for the whole search. */
  maxDurationMs?: number;
  /** Total versions produced, counting failed ones. */
  maxNodes?: number;
  /** Stop after this many consecutive candidates without a new best. */
  plateauNodes?: number;
}

/**
 * Knobs of the selection rule (rank the whole tree, decay by visits). Kept
 * loose on purpose — the rule itself ships with the runtime, and recording its
 * parameters here is what makes a finished tree's shape reproducible.
 */
export interface EvolutionSelectionPolicy {
  /** Multiplicative weight decay applied per recorded visit. */
  visitDecay?: number;
}

export interface EvolutionTreeConfig {
  budget?: EvolutionBudget;
  selection?: EvolutionSelectionPolicy;
}
