interface NotifyImageCompletedParams {
  duration: number;
  generationBatchId: string;
  model: string;
  prompt: string;
  topicId?: string;
  userId: string;
}

export async function notifyImageCompleted(_params: NotifyImageCompletedParams): Promise<void> {}
