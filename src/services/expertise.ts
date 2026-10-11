import { lambdaClient, withLlmRelay } from '@/libs/trpc/client';
import { oneShotRelay, type OneShotRelayHandle } from '@/services/llmRelay';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';

/**
 * Drafting runs server-side on the `expertise` system agent; a model only this
 * device reaches is relayed back to this tab (one-shot relay).
 */
const runOnExpertiseModel = <T>(request: (relay?: OneShotRelayHandle) => Promise<T>) =>
  oneShotRelay.run(systemAgentSelectors.expertise(useUserStore.getState()).provider, request);

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
export type DistillResult = Awaited<ReturnType<typeof lambdaClient.expertise.distillRules.mutate>>;
export type DistillCandidate = DistillResult['candidates'][number];
export type DistillInput = Parameters<typeof lambdaClient.expertise.distillRules.mutate>[0];
export type CommitDistilledInput = Parameters<
  typeof lambdaClient.expertise.commitDistilledRules.mutate
>[0];
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
  }) =>
    runOnExpertiseModel((relay) =>
      lambdaClient.expertise.draftRule.mutate(input, withLlmRelay(relay)),
    );

  draftRuleGroup = async (brief: string) =>
    runOnExpertiseModel((relay) =>
      lambdaClient.expertise.draftRuleGroup.mutate({ brief }, withLlmRelay(relay)),
    );

  distillRules = async (input: DistillInput) => lambdaClient.expertise.distillRules.mutate(input);

  commitDistilledRules = async (input: CommitDistilledInput) =>
    lambdaClient.expertise.commitDistilledRules.mutate(input);

  createRule = async (input: CreateRuleInput) => lambdaClient.expertise.createRule.mutate(input);

  updateRule = async (lessonId: string, patch: UpdateRuleInput) =>
    lambdaClient.expertise.updateRule.mutate({ lessonId, ...patch });

  judgeRuleDirections = async (lessonIds: string[]) =>
    runOnExpertiseModel((relay) =>
      lambdaClient.expertise.judgeRuleDirections.mutate({ lessonIds }, withLlmRelay(relay)),
    );

  reorderRule = async (domainId: string, lessonId: string, beforeId: string | null) =>
    lambdaClient.expertise.reorderRule.mutate({ beforeId, domainId, lessonId });

  moveRule = async (lessonId: string, domainId: string) =>
    lambdaClient.expertise.moveRule.mutate({ domainId, lessonId });

  mergeRules = async (fromId: string, intoId: string) =>
    lambdaClient.expertise.mergeRules.mutate({ fromId, intoId });

  archiveRule = async (lessonId: string) =>
    lambdaClient.expertise.retireLesson.mutate({ lessonId });

  restoreRule = async (lessonId: string) =>
    lambdaClient.expertise.restoreLesson.mutate({ lessonId });

  createRuleGroup = async (input: { gate: string; outOfScope?: string; title: string }) =>
    lambdaClient.expertise.createRuleGroup.mutate(input);

  updateRuleGroup = async (
    domainId: string,
    patch: { gate?: string; outOfScope?: string | null; title?: string },
  ) => lambdaClient.expertise.updateRuleGroup.mutate({ domainId, ...patch });

  getDomain = async (domainId: string) => lambdaClient.expertise.getDomain.query({ domainId });

  getLesson = async (lessonId: string) => lambdaClient.expertise.getLesson.query({ lessonId });

  draftDomain = async (params: {
    adjustment?: string;
    agentId: string;
    brief: string;
    currentDraft?: ExpertiseDomainDraft;
  }) =>
    runOnExpertiseModel((relay) =>
      lambdaClient.expertise.draftDomain.mutate(params, withLlmRelay(relay)),
    );

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
