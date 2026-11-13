import type { UserSkillVersionDetail } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

export type UserSkillDetail = NonNullable<
  Awaited<ReturnType<typeof lambdaClient.userSkill.get.query>>
>;
export type UserSkillVersion = UserSkillDetail['versions'][number];

class UserSkillService {
  get = async (id: string) => lambdaClient.userSkill.get.query({ id });

  getVersion = async (id: string, version: number): Promise<UserSkillVersionDetail | null> =>
    lambdaClient.userSkill.getVersion.query({ id, version });
}

export const userSkillService = new UserSkillService();
