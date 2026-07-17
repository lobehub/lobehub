import type { OnboardingSuggestedTask } from '@lobechat/types';

const MOCK_SUGGESTED_TASKS: OnboardingSuggestedTask[] = [
  {
    checked: true,
    id: 'draft-reply',
    title: 'Draft a reply to the most important email in my inbox',
  },
  { checked: true, id: 'recap-study', title: "Recap my child's study progress this week" },
  {
    checked: true,
    id: 'pick-papers',
    title: 'Pick the 3 papers from my research area that were most cited',
  },
  { checked: true, id: 'follow-up', title: 'Find everything I need to follow up on' },
  { checked: false, id: 'review-slack', title: 'Review Slack Marketplace submission update' },
  { checked: false, id: 'check-payment', title: 'Check BytePlus payment confirmation' },
];

class OnboardingTasksService {
  getSuggestions = async (): Promise<OnboardingSuggestedTask[]> => MOCK_SUGGESTED_TASKS;

  createTasks = async (_ids: string[]): Promise<void> => {};
}

export const onboardingTasksService = new OnboardingTasksService();
