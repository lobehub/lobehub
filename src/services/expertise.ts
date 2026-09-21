import { lambdaClient } from '@/libs/trpc/client';

export type ExpertiseOverview = Awaited<
  ReturnType<typeof lambdaClient.expertise.listByAgent.query>
>;
export type ExpertiseDomainItem = ExpertiseOverview['domains'][number];
export type ExpertiseHabit = ExpertiseDomainItem['lessons'][number];
export type ExpertiseDomainDetail = NonNullable<
  Awaited<ReturnType<typeof lambdaClient.expertise.getDomain.query>>
>;
export type ExpertiseLessonDetail = NonNullable<
  Awaited<ReturnType<typeof lambdaClient.expertise.getLesson.query>>
>;
export type ExpertiseDomainDraft = Awaited<
  ReturnType<typeof lambdaClient.expertise.draftDomain.mutate>
>;

export type StandardsOverview = Awaited<
  ReturnType<typeof lambdaClient.expertise.listStandards.query>
>;
export type StandardGroup = StandardsOverview['groups'][number];
export type StandardItem = StandardGroup['standards'][number];
export type StandardSource = Awaited<
  ReturnType<typeof lambdaClient.expertise.standardSources.query>
>[number];
export type StandardRevision = Awaited<
  ReturnType<typeof lambdaClient.expertise.standardRevisions.query>
>[number];

class ExpertiseService {
  listByAgent = async (agentId: string) => lambdaClient.expertise.listByAgent.query({ agentId });

  listStandards = async () => lambdaClient.expertise.listStandards.query();

  standardSources = async (lessonId: string) =>
    lambdaClient.expertise.standardSources.query({ lessonId });

  standardRevisions = async (lessonId: string) =>
    lambdaClient.expertise.standardRevisions.query({ lessonId });

  reviseStandard = async (lessonId: string, text: string) =>
    lambdaClient.expertise.reviseLesson.mutate({ lessonId, text });

  archiveStandard = async (lessonId: string) =>
    lambdaClient.expertise.retireLesson.mutate({ lessonId });

  restoreStandard = async (lessonId: string) =>
    lambdaClient.expertise.restoreLesson.mutate({ lessonId });

  getDomain = async (domainId: string) => lambdaClient.expertise.getDomain.query({ domainId });

  getLesson = async (lessonId: string) => lambdaClient.expertise.getLesson.query({ lessonId });

  draftDomain = async (params: {
    adjustment?: string;
    agentId: string;
    brief: string;
    currentDraft?: ExpertiseDomainDraft;
  }) => lambdaClient.expertise.draftDomain.mutate(params);

  createDomain = async (params: ExpertiseDomainDraft & { agentId: string; brief: string }) =>
    lambdaClient.expertise.createDomain.mutate(params);

  deleteDomain = async (domainId: string) =>
    lambdaClient.expertise.deleteDomain.mutate({ domainId });

  countHistory = async (agentId: string) => lambdaClient.expertise.countHistory.query({ agentId });

  ingestHistory = async (agentId: string) =>
    lambdaClient.expertise.ingestHistory.mutate({ agentId });

  teachLesson = async (params: { domainId: string; text: string }) =>
    lambdaClient.expertise.teachLesson.mutate(params);

  reviseLesson = async (params: { lessonId: string; text: string }) =>
    lambdaClient.expertise.reviseLesson.mutate(params);

  retireLesson = async (lessonId: string) =>
    lambdaClient.expertise.retireLesson.mutate({ lessonId });

  dismissInsight = async (insightId: string, reason?: string) =>
    lambdaClient.expertise.dismissInsight.mutate({ insightId, reason });
}

export const expertiseService = new ExpertiseService();
