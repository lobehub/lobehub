import { readRequiredEvidence as readSpecs } from '@lobechat/const/verify';
import type { RequiredEvidenceSpec } from '@lobechat/types';

// The coverage rule lives in `@lobechat/const/verify` so the CLI reports the
// same gaps the verifier's structural gate enforces.
export { coverageGaps, runEvidenceGaps } from '@lobechat/const/verify';

export const readRequiredEvidence = (
  config: Record<string, unknown> | undefined | null,
): RequiredEvidenceSpec[] | undefined => readSpecs<RequiredEvidenceSpec>(config);
