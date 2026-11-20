import { readRequiredEvidence as readSpecs } from '@lobechat/const/verify';
import type { RequiredEvidenceSpec, VerifyEvidenceType } from '@lobechat/types';
import { type CoverageEvidence, coverageGaps } from '@lobechat/utils/verify/evidenceCoverage';

export { coverageGaps, executionGapTypes } from '@lobechat/utils/verify/evidenceCoverage';

/**
 * Read the (optional) evidence requirement a criterion declares on its config.
 * Evidence-driven criteria list the artifact types they need under
 * `verifierConfig.requiredEvidence`; everything else returns undefined.
 */
export const readRequiredEvidence = (
  config: Record<string, unknown> | undefined | null,
): RequiredEvidenceSpec[] | undefined => readSpecs<RequiredEvidenceSpec>(config);

/** The requirements the run itself must evidence — see {@link runEvidenceGaps}. */
export const runEvidenceSpecs = (config: Record<string, unknown> | undefined | null) =>
  readRequiredEvidence(config)?.filter((spec) => !spec.scope || spec.scope === 'run_evidence');

/**
 * Run-evidence types a criterion still misses. `deliverable` / `task_artifacts`
 * requirements are resolved by the verifier from the operation's documents and
 * files, so only `run_evidence` must exist as verify_evidence rows. This is the
 * one coverage rule shared by the builder handoff and the structural gate:
 * when they disagree, a builder that already evidenced a criterion is treated
 * as missing evidence and gets its final report pasted into every check.
 */
export const runEvidenceGaps = (
  config: Record<string, unknown> | undefined | null,
  evidence: CoverageEvidence[],
): VerifyEvidenceType[] => coverageGaps(runEvidenceSpecs(config), evidence);
