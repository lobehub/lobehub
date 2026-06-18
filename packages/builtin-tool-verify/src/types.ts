export const VerifyToolApiName = {
  /** Submit the verdict for the check this verifier sub-agent was asked to judge. */
  submitVerifyResult: 'submitVerifyResult',
} as const;

export type VerifyToolApiNameType = (typeof VerifyToolApiName)[keyof typeof VerifyToolApiName];

/** The verdict a verifier sub-agent reaches for a single delivery check. */
export type VerifyToolVerdict = 'passed' | 'failed' | 'uncertain';

/** Arguments the verifier sub-agent passes to `submitVerifyResult`. */
export interface SubmitVerifyResultParams {
  /** The id of the check being judged (given to the agent in its instructions). */
  checkItemId: string;
  /** Counter-evidence pointing the other way, if any. */
  counterEvidence?: string;
  /** The concrete evidence from the work supporting the verdict. */
  evidence?: string;
  /** What could not be verified and why. */
  limitation?: string;
  /** Why the evidence supports the verdict. */
  reasoning?: string;
  /** A concrete fix when the verdict is failed/uncertain. */
  suggestion?: string;
  /** The judgement for this check. */
  verdict: VerifyToolVerdict;
}
