export const AcceptanceEvidenceApiName = {
  listCriteria: 'listCriteria',
  submitEvidence: 'submitEvidence',
} as const;

export type AcceptanceEvidenceType = 'markdown' | 'screenshot' | 'text' | 'video';

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
