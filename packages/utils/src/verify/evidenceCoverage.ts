import type { RequiredEvidenceSpec, VerifyEvidenceType } from '@lobechat/types';

import { isExecutionEvidence } from './terminalEvidence';

/**
 * Same-medium types that also satisfy a declared requirement. The gate checks
 * that an artifact of the right medium exists; whether it proves the criterion
 * is the judge's call. Without this, a recording uploaded as `video` against a
 * `gif` requirement, or a CLI log uploaded as `text` against `transcript`,
 * failed every repair round on a label while the judge never saw the artifact.
 * A GIF is a run of screenshots, and judges receive it as a frame sheet (see
 * `renderGifFrameSheet`), so it also answers a `screenshot` requirement — a GIF
 * uploaded as `screenshot` is stored as `gif`, which otherwise failed the gate
 * on the very artifact it asked for. A `terminal` evidence carries a text
 * payload, so it stands in for `text` and `transcript`; nothing stands in for
 * `terminal`, whose point is the structured execution record. `dom_snapshot`
 * and `audio` have no substitute.
 */
const SATISFIED_BY: Partial<Record<VerifyEvidenceType, VerifyEvidenceType[]>> = {
  gif: ['video'],
  markdown: ['text', 'transcript'],
  screenshot: ['gif'],
  text: ['markdown', 'transcript', 'terminal'],
  transcript: ['text', 'markdown', 'terminal'],
  video: ['gif'],
};

export interface CoverageEvidence {
  metadata?: unknown;
  type: VerifyEvidenceType;
}

/**
 * Which required evidence types are still missing for a criterion — pure, so the
 * structural gate is unit-testable without a database. Returns `[]` when the
 * item declares no evidence requirement (nothing to gate on).
 *
 * A spec with `provenance: 'execution'` is matched only against evidence that
 * can stand for a real command run ({@link isExecutionEvidence}): format
 * compatibility says the attachment has the right shape, never that anything
 * ran, so an authored example or a bare text log does not cover it.
 */
export const coverageGaps = (
  required: RequiredEvidenceSpec[] | undefined,
  evidence: CoverageEvidence[],
): VerifyEvidenceType[] => {
  if (!required?.length) return [];
  const all = new Set(evidence.map((e) => e.type));
  const executed = new Set(evidence.filter(isExecutionEvidence).map((e) => e.type));
  const gaps = new Set<VerifyEvidenceType>();
  for (const spec of required) {
    const present = spec.provenance === 'execution' ? executed : all;
    if (!present.has(spec.type) && !SATISFIED_BY[spec.type]?.some((alt) => present.has(alt)))
      gaps.add(spec.type);
  }
  return [...gaps];
};

/** The gap types that are missing because no real execution backs them. */
export const executionGapTypes = (
  required: RequiredEvidenceSpec[] | undefined,
  gaps: VerifyEvidenceType[],
): VerifyEvidenceType[] =>
  gaps.filter((type) =>
    required?.some((spec) => spec.type === type && spec.provenance === 'execution'),
  );
