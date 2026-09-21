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

export type RulesOverview = Awaited<ReturnType<typeof lambdaClient.expertise.listRules.query>>;
export type RuleGroup = RulesOverview['groups'][number];
export type RuleItem = RuleGroup['rules'][number];
export type RuleScope = RuleGroup['scopes'][number];
export type RuleSource = Awaited<
  ReturnType<typeof lambdaClient.expertise.ruleSources.query>
>[number];
export type RuleRevision = Awaited<
  ReturnType<typeof lambdaClient.expertise.ruleRevisions.query>
>[number];
export type RuleDraft = Awaited<ReturnType<typeof lambdaClient.expertise.draftRule.mutate>>;
export type RuleGroupDraft = Awaited<
  ReturnType<typeof lambdaClient.expertise.draftRuleGroup.mutate>
>;
export type CreateRuleInput = Parameters<typeof lambdaClient.expertise.createRule.mutate>[0];
export type UpdateRuleInput = Omit<
  Parameters<typeof lambdaClient.expertise.updateRule.mutate>[0],
  'lessonId'
>;

class ExpertiseService {
  listByAgent = async (agentId: string) => lambdaClient.expertise.listByAgent.query({ agentId });

  listRules = async () => lambdaClient.expertise.listRules.query();

  ruleSources = async (lessonId: string) => lambdaClient.expertise.ruleSources.query({ lessonId });

  ruleRevisions = async (lessonId: string) =>
    lambdaClient.expertise.ruleRevisions.query({ lessonId });

  draftRule = async (input: {
    brief: string;
    groups: { gate: string; id: string; title: string }[];
  }) => lambdaClient.expertise.draftRule.mutate(input);

  draftRuleGroup = async (brief: string) => lambdaClient.expertise.draftRuleGroup.mutate({ brief });

  createRule = async (input: CreateRuleInput) => lambdaClient.expertise.createRule.mutate(input);

  updateRule = async (lessonId: string, patch: UpdateRuleInput) =>
    lambdaClient.expertise.updateRule.mutate({ lessonId, ...patch });

  reorderRules = async (domainId: string, lessonIds: string[]) =>
    lambdaClient.expertise.reorderRules.mutate({ domainId, lessonIds });

  moveRule = async (lessonId: string, domainId: string) =>
    lambdaClient.expertise.moveRule.mutate({ domainId, lessonId });

  mergeRules = async (fromId: string, intoId: string) =>
    lambdaClient.expertise.mergeRules.mutate({ fromId, intoId });

  archiveRule = async (lessonId: string) =>
    lambdaClient.expertise.retireLesson.mutate({ lessonId });

  restoreRule = async (lessonId: string) =>
    lambdaClient.expertise.restoreLesson.mutate({ lessonId });

  createRuleGroup = async (input: { gate: string; title: string }) =>
    lambdaClient.expertise.createRuleGroup.mutate(input);

  updateRuleGroup = async (domainId: string, patch: { gate?: string; title?: string }) =>
    lambdaClient.expertise.updateRuleGroup.mutate({ domainId, ...patch });

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
