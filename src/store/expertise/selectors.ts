import type { ReplicaSource } from '@/libs/replica';
import type {
  ExpertiseDomainDetail,
  ExpertiseLessonDetail,
  ExpertiseOverview,
  RuleRevision,
  RuleSource,
  RulesOverview,
} from '@/services/expertise';

import type { ExpertiseState } from './initialState';
import { type ExpertiseHistoryCount, RULES_KEY } from './projection';

/**
 * A value painted from IndexedDB (`storage`) is last session's answer, not the
 * server's: it may be an empty or outdated snapshot. Only a server response or
 * a write made on top of one counts as confirmed, so "nothing here" / "not
 * found" is said only then.
 */
const isConfirmedSource = (source: ReplicaSource | undefined) =>
  source === 'server' || source === 'local';

/** Each read is `undefined` until the local copy or the server fills it. */
const rules = (s: ExpertiseState): RulesOverview | undefined => s.rulesMap[RULES_KEY];

const isRulesConfirmed = (s: ExpertiseState): boolean =>
  isConfirmedSource(s.rulesReplica.entries[RULES_KEY]?.source);

const ruleSources =
  (lessonId?: string) =>
  (s: ExpertiseState): RuleSource[] | undefined =>
    lessonId ? s.ruleSourcesMap[lessonId] : undefined;

const isRuleSourcesConfirmed =
  (lessonId?: string) =>
  (s: ExpertiseState): boolean =>
    !!lessonId && isConfirmedSource(s.ruleSourcesReplica.entries[lessonId]?.source);

const ruleRevisions =
  (lessonId?: string) =>
  (s: ExpertiseState): RuleRevision[] | undefined =>
    lessonId ? s.ruleRevisionsMap[lessonId] : undefined;

const overview =
  (agentId?: string) =>
  (s: ExpertiseState): ExpertiseOverview | undefined =>
    agentId ? s.overviewMap[agentId] : undefined;

const isOverviewConfirmed =
  (agentId?: string) =>
  (s: ExpertiseState): boolean =>
    !!agentId && isConfirmedSource(s.overviewReplica.entries[agentId]?.source);

const domain =
  (domainId?: string) =>
  (s: ExpertiseState): ExpertiseDomainDetail | undefined =>
    domainId ? s.domainMap[domainId] : undefined;

const lesson =
  (lessonId?: string) =>
  (s: ExpertiseState): ExpertiseLessonDetail | undefined =>
    lessonId ? s.lessonMap[lessonId] : undefined;

/** The server answered that this lesson no longer exists (not merely "not loaded yet"). */
const isLessonNotFound =
  (lessonId?: string) =>
  (s: ExpertiseState): boolean =>
    !!lessonId && !!s.lessonNotFoundMap[lessonId];

const historyCount =
  (agentId?: string) =>
  (s: ExpertiseState): ExpertiseHistoryCount | undefined =>
    agentId ? s.historyCountMap[agentId] : undefined;

export const expertiseSelectors = {
  domain,
  historyCount,
  isLessonNotFound,
  isOverviewConfirmed,
  isRuleSourcesConfirmed,
  isRulesConfirmed,
  lesson,
  overview,
  ruleRevisions,
  ruleSources,
  rules,
};
