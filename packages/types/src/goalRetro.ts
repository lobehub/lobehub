/**
 * The retro after one execution of a batch — its probes, or one roster wave.
 * It distills two layers from what ran: experience into the plan skill (how a
 * unit is done) and criteria into the verifier (what a unit is judged on). The
 * gate only opens on a retro that is done.
 */
export interface GoalRolloutRetro {
  /** Every person's intervention in that execution, and how many it accounted for. */
  interventions?: { accounted: number; total: number };
  /**
   * The round this retro opened: a wave sent back at its gate is distilled into
   * the plan and criteria the next round runs on.
   */
  opens?: number;
  /** The delivered units re-verified against the retro's verifier. */
  reverify?: { failed?: number; passed: number; total: number };
  /** Plan steps the retro added or changed. */
  skillChanges?: number;
  /** The plan skill version the retro produced. */
  skillVersion?: number;
  status: 'blocked' | 'done' | 'running';
  /** Criteria the retro added, tightened, or loosened (loosening waits on a person). */
  verifierChanges?: { added?: number; loosened?: number; tightened?: number };
  /** The verifier version the retro produced. */
  verifierVersion?: number;
  /** What it read: 0 for the probes, N for roster wave N (1-based). */
  wave: number;
}

/** The batch's verifier: what every unit's acceptance is judged on, versioned by its retros. */
export interface GoalRolloutVerifier {
  /** Blocking and advisory criteria in the current version. */
  criteria: { block: number; warn: number };
  version: number;
}
