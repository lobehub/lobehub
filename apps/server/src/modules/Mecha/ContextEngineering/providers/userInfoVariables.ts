import { UserModel } from '@/database/models/user';
import { log } from '@/server/modules/AgentRuntime/executorHelpers';

import type { ServerContextFactInput } from './types';

export interface UserInfoVariables {
  language: string;
  username: string;
}

/**
 * `{{username}}` / `{{language}}` render back to whoever is actually
 * conversing. In a share-visitor run `ctx.userId` is the CREATOR (the agent
 * still executes under their identity), so resolving from it would leak the
 * creator's own name / locale into a link visitor's turn. Resolve from the
 * visitor's own user id instead whenever this is a share-visitor run.
 */
export const resolveUserInfoVariables = async ({
  ctx,
}: ServerContextFactInput): Promise<UserInfoVariables> => {
  const userInfoUserId = ctx.agentShareVisitor?.visitorUserId ?? ctx.userId;
  if (!ctx.serverDB || !userInfoUserId) return { language: '', username: '' };
  try {
    const userInfo = await UserModel.getInfoForAIGeneration(ctx.serverDB, userInfoUserId);
    return { language: userInfo.responseLanguage, username: userInfo.userName };
  } catch (error) {
    log('Failed to fetch user info for {{username}}/{{language}} substitution: %O', error);
    return { language: '', username: '' };
  }
};
