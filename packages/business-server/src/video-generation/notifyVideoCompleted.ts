interface NotifyVideoCompletedParams {
  generationBatchId: string;
  model: string;
  prompt: string;
  topicId?: string;
  userId: string;
  /** Present when the generation ran in a workspace — the notification then follows that context. */
  workspaceId?: string;
}

export async function notifyVideoCompleted(_params: NotifyVideoCompletedParams): Promise<void> {}
