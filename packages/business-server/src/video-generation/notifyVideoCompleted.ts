interface NotifyVideoCompletedParams {
  generationBatchId: string;
  model: string;
  prompt: string;
  topicId?: string;
  userId: string;
}

export async function notifyVideoCompleted(_params: NotifyVideoCompletedParams): Promise<void> {}
