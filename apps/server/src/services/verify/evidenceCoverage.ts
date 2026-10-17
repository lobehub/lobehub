import type { RequiredEvidenceSpec, VerifyEvidenceType } from '@lobechat/types';

/**
 * Read the (optional) evidence requirement a criterion declares on its config.
 * Evidence-driven criteria list the artifact types they need under
 * `verifierConfig.requiredEvidence`; everything else returns undefined.
 */
export const readRequiredEvidence = (
  config: Record<string, unknown> | undefined | null,
): RequiredEvidenceSpec[] | undefined => {
  const raw = config?.requiredEvidence;
  return Array.isArray(raw) ? (raw as RequiredEvidenceSpec[]) : undefined;
};

/**
 * Same-medium types that also satisfy a declared requirement. The gate checks
 * that an artifact of the right medium exists; whether it proves the criterion
 * is the judge's call. Without this, a recording uploaded as `video` against a
 * `gif` requirement, or a CLI log uploaded as `text` against `transcript`,
 * failed every repair round on a label while the judge never saw the artifact.
 * A GIF is a run of screenshots, and judges receive it as a frame sheet (see
 * `renderGifFrameSheet`), so it also answers a `screenshot` requirement — a GIF
 * uploaded as `screenshot` is stored as `gif`, which otherwise failed the gate
 * on the very artifact it asked for. `dom_snapshot` and `audio` have no
 * substitute.
 */
const SATISFIED_BY: Partial<Record<VerifyEvidenceType, VerifyEvidenceType[]>> = {
  gif: ['video'],
  markdown: ['text', 'transcript'],
  screenshot: ['gif'],
  text: ['markdown', 'transcript'],
  transcript: ['text', 'markdown'],
  video: ['gif'],
};

/**
 * Which required evidence types are still missing for a criterion — pure, so the
 * structural gate is unit-testable without a database. Returns `[]` when the
 * item declares no evidence requirement (nothing to gate on).
 */
export const coverageGaps = (
  required: RequiredEvidenceSpec[] | undefined,
  evidence: { type: VerifyEvidenceType }[],
): VerifyEvidenceType[] => {
  if (!required?.length) return [];
  const present = new Set(evidence.map((e) => e.type));
  return [...new Set(required.map((r) => r.type))].filter(
    (t) => !present.has(t) && !SATISFIED_BY[t]?.some((alt) => present.has(alt)),
  );
};

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
  evidence: { type: VerifyEvidenceType }[],
): VerifyEvidenceType[] =>
  coverageGaps(
    readRequiredEvidence(config)?.filter((spec) => !spec.scope || spec.scope === 'run_evidence'),
    evidence,
  );
