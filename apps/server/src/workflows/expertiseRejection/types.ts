export interface ExpertiseRejectionWorkflowPayload {
  acceptanceId: string;
  userId: string;
  /** The settled round whose rejections are being distilled — not the round that just landed. */
  verifyRunId: string;
  workspaceId?: string;
}
