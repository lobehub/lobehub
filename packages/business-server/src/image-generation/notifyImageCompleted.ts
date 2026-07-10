interface NotifyImageCompletedParams {
  duration: number;
  generationBatchId: string;
  model: string;
  prompt: string;
  topicId?: string;
  userId: string;
}

// eslint-disable-next-line unused-imports/no-unused-vars
export async function notifyImageCompleted(params: NotifyImageCompletedParams): Promise<void> {}
