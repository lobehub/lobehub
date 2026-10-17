import { lambdaClient } from '@/libs/trpc/client';

export type UserSkillDetail = NonNullable<
  Awaited<ReturnType<typeof lambdaClient.userSkill.get.query>>
>;
export type UserSkillVersion = UserSkillDetail['versions'][number];

class UserSkillService {
  get = async (id: string) => lambdaClient.userSkill.get.query({ id });
}

export const userSkillService = new UserSkillService();
