import { lambdaClient } from '@/libs/trpc/client';

export type UserSkillDetail = NonNullable<
  Awaited<ReturnType<typeof lambdaClient.userSkill.get.query>>
>;
export type UserSkillVersion = UserSkillDetail['versions'][number];
export type UserSkillVersionDetail = NonNullable<
  Awaited<ReturnType<typeof lambdaClient.userSkill.getVersion.query>>
>;

class UserSkillService {
  get = async (id: string) => lambdaClient.userSkill.get.query({ id });

  getVersion = async (id: string, version: number) =>
    lambdaClient.userSkill.getVersion.query({ id, version });
}

export const userSkillService = new UserSkillService();
