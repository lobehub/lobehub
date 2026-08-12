import { lambdaClient } from '@/libs/trpc/client';

export type ExpertiseOverview = Awaited<
  ReturnType<typeof lambdaClient.expertise.listByAgent.query>
>;
export type ExpertiseDomainItem = ExpertiseOverview['domains'][number];
export type ExpertiseInsightItem = ExpertiseOverview['insights'][number];
export type ExpertiseDomainDetail = NonNullable<
  Awaited<ReturnType<typeof lambdaClient.expertise.getDomain.query>>
>;
export type ExpertiseLessonItem = Awaited<
  ReturnType<typeof lambdaClient.expertise.listLessons.query>
>[number];
export type ExpertiseLessonDetail = NonNullable<
  Awaited<ReturnType<typeof lambdaClient.expertise.getLesson.query>>
>;
/** 成熟度是个联合类型：可用时有百分比，不可用时只有原因。界面必须两种都渲染。 */
export type ExpertiseMaturity = ExpertiseDomainItem['maturity'];

class ExpertiseService {
  listByAgent = async (agentId: string) => lambdaClient.expertise.listByAgent.query({ agentId });

  getDomain = async (domainId: string) => lambdaClient.expertise.getDomain.query({ domainId });

  listLessons = async (params: { domainId: string; layer?: string; search?: string }) =>
    lambdaClient.expertise.listLessons.query(params);

  getLesson = async (lessonId: string) => lambdaClient.expertise.getLesson.query({ lessonId });

  createDomain = async (params: {
    agentId: string;
    description?: string;
    domainFilter: string;
    title: string;
  }) => lambdaClient.expertise.createDomain.mutate(params);

  chooseAnchor = async (domainId: string, candidateKey: string) =>
    lambdaClient.expertise.chooseAnchor.mutate({ candidateKey, domainId });

  dismissInsight = async (insightId: string, reason?: string) =>
    lambdaClient.expertise.dismissInsight.mutate({ insightId, reason });
}

export const expertiseService = new ExpertiseService();
