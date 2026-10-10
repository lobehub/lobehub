export const AcceptanceEvidenceApiName = {
  authorCriteria: 'authorCriteria',
  listCriteria: 'listCriteria',
  submitEvidence: 'submitEvidence',
} as const;

export type AcceptanceEvidenceType = 'markdown' | 'screenshot' | 'text' | 'video';

/**
 * One acceptance standard the builder authors for itself.
 *
 * Used only when the run carries no criteria at all (auto-instantiation failed
 * or was never configured): the builder states the standards its delivery must
 * meet, instead of finishing with no checklist and no evidence.
 */
export interface AuthorAcceptanceCriteriaItem {
  /** What this standard means — the point the evidence has to address. */
  description?: string;
  /** Defaults to true: an authored standard is assumed blocking unless said otherwise. */
  required?: boolean;
  /** One-sentence standard, e.g. "The two transport packages ship in their own PRs". */
  title: string;
}

export interface AuthorAcceptanceCriteriaParams {
  items: AuthorAcceptanceCriteriaItem[];
}

export interface SubmitAcceptanceEvidenceParams {
  checkItemId: string;
  evidence: Array<{
    content?: string;
    description?: string;
    documentId?: string;
    fileId?: string;
    type: AcceptanceEvidenceType;
  }>;
}

export interface AcceptanceCriterionSummary {
  /** The `checkItemId` to pass back to `submitEvidence`. */
  id: string;
  index: number;
  required: boolean;
  /** Evidence types the criterion asks for, when it declares any. */
  requiredEvidence?: Array<{ hint?: string; type: string }>;
  /** Evidence already recorded for this criterion in the current run. */
  submittedEvidence: number;
  title: string;
}
