import type { OnboardingSuggestedTask } from '@lobechat/types';

class OnboardingTasksService {
  getSuggestions = async (): Promise<OnboardingSuggestedTask[]> => {
    throw new Error('onboardingTasksService.getSuggestions is not implemented yet');
  };

  createTasks = async (ids: string[]): Promise<void> => {
    throw new Error(`onboardingTasksService.createTasks is not implemented yet: ${ids.join(',')}`);
  };
}

export const onboardingTasksService = new OnboardingTasksService();
