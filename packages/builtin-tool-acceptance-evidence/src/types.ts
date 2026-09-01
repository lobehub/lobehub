export const AcceptanceEvidenceApiName = {
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
