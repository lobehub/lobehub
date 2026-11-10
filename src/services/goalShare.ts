import type { ShareVisibility } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

/** The owner's view of a goal's share record; `id` is the segment of `/share/goal/:id`. */
export interface GoalShareInfo {
  goalId: string;
  id: string;
  pageViewCount: number;
  userId: string;
  visibility: ShareVisibility;
}

/** Every method takes the `goals` row id, like the rest of the goal API. */
class GoalShareService {
  /** The goal's share record, or null while it is not shared. */
  getInfo = async (goalId: string): Promise<GoalShareInfo | null> => {
    const { data } = await lambdaClient.goalShare.getInfo.query({ goalId });
    return data;
  };

  /** Create the share, or reuse the existing one, at the given visibility. */
  enable = async (goalId: string, visibility: ShareVisibility): Promise<GoalShareInfo | null> => {
    const { data } = await lambdaClient.goalShare.enable.mutate({ goalId, visibility });
    return data ? { ...data, pageViewCount: data.pageViewCount ?? 0 } : null;
  };

  setVisibility = async (goalId: string, visibility: ShareVisibility): Promise<GoalShareInfo> => {
    const { data } = await lambdaClient.goalShare.setVisibility.mutate({ goalId, visibility });
    return data;
  };

  /** Remove the share record; the link stops resolving. */
  disable = async (goalId: string): Promise<void> => {
    await lambdaClient.goalShare.disable.mutate({ goalId });
  };
}

export const goalShareService = new GoalShareService();
