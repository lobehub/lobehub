export const LobeDeliveryCheckerIdentifier = 'lobe-delivery-checker';

export const LobeDeliveryCheckerApiName = {
  generateVerifyPlan: 'generateVerifyPlan',
} as const;

export type LobeDeliveryCheckerApiNameType =
  (typeof LobeDeliveryCheckerApiName)[keyof typeof LobeDeliveryCheckerApiName];

// ==================== Verify (delivery checker) ====================

/** How a single delivery check is judged. */
export type VerifyVerifierType = 'program' | 'agent' | 'llm';
/** What to do when a delivery check fails. */
export type VerifyOnFailStrategy = 'manual' | 'auto_repair';

/**
 * One delivery check the agent defines for the run. Fully specified by the
 * model (like `createDocument` writes a whole document) — on confirmation each
 * becomes a `verify_criteria` row aggregated under the run's rubric.
 */
export interface VerifyCriterionInput {
  /** A one-sentence summary of what this check verifies (required). */
  description: string;
  /**
   * The detailed, fine-grained judging rubric (required): the exact pass
   * conditions, what counts as a fail, the concrete evidence the judge must find,
   * and edge cases. Written thoroughly — the judge relies on it.
   */
  instruction: string;
  /** Action on failure. Defaults to 'manual'. */
  onFail?: VerifyOnFailStrategy;
  /** Whether this check is required (must pass to deliver) vs optional. Defaults to true. */
  required?: boolean;
  /** The short title of this check. */
  title: string;
  /** How this check is judged. Defaults to 'llm'. */
  verifierType?: VerifyVerifierType;
}

/**
 * Define the delivery-checker plan for the current Agent Run. The agent calls
 * this before doing substantive work, enumerating the checks the deliverable
 * must satisfy. On confirmation the criteria + a rubric are created in the DB
 * and snapshotted onto the operation.
 */
export interface GenerateVerifyPlanParams {
  /** The checks the deliverable must satisfy — one entry per check. */
  criteria: VerifyCriterionInput[];
  /** The delivery standard's title — typically the user's task / goal. */
  title: string;
}

/**
 * A created check item, surfaced on the tool message for the Render. The
 * detailed `instruction` is not carried here — it lives in the criterion's
 * linked document; only the concise `description` is shown in the check list.
 */
export interface GeneratedVerifyCheck {
  /** The persisted `verify_criteria.id` — lets the client write edits back. */
  criterionId?: string;
  /** One-sentence summary shown under the title. */
  description?: string;
  /** The instruction document id — lets the client edit the detailed rubric. */
  documentId?: string;
  onFail: VerifyOnFailStrategy;
  /** Whether this check is required (must pass) vs optional. */
  required: boolean;
  title: string;
  verifierType: VerifyVerifierType;
}

/** State persisted on the generateVerifyPlan tool message (drives the Render). */
export interface GenerateVerifyPlanState {
  /** The created check items, in plan order. */
  items: GeneratedVerifyCheck[];
  /** The created rubric id (`verify_rubrics.id`). */
  rubricId?: string;
  /** The rubric / delivery-standard title. */
  title: string;
}
