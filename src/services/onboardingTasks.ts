import type { OnboardingSuggestedTask } from '@lobechat/types';

class OnboardingTasksService {
  getSuggestions = async (): Promise<OnboardingSuggestedTask[]> => {
    throw new Error('onboardingTasksService.getSuggestions is not implemented yet');
  };

  createTasks = async (_ids: string[]): Promise<void> => {
    throw new Error('onboardingTasksService.createTasks is not implemented yet');
  };
}

export const onboardingTasksService = new OnboardingTasksService();
