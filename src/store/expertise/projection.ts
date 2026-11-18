import { defineReplica } from '@/libs/replica';
import type {
  ExpertiseDomainDetail,
  ExpertiseLessonDetail,
  ExpertiseOverview,
  expertiseService,
  RuleRevision,
  RuleSource,
  RulesOverview,
} from '@/services/expertise';

/** The only entry of the reviewer's rule sheet: one query, no parameters. */
export const RULES_KEY = 'self';

/** The candidate count the history warm-up card shows. */
export type ExpertiseHistoryCount = Awaited<ReturnType<typeof expertiseService.countHistory>>;

/**
 * Every expertise read is persisted to IndexedDB under the replica's user +
 * workspace scope, so My rules and an agent's Self-evolving pages paint the last
 * sheet on reload and revalidate in the background. Resource names stay clear
 * of the legacy SWR `expertise:` keys so nothing is stored twice.
 */
export const expertiseRulesResource = defineReplica<typeof RULES_KEY, RulesOverview>({
  key: () => RULES_KEY,
  name: 'expertiseRules',
  storage: 'indexedDB',
  version: 1,
});

/** The evidence a rule grew from, per lesson id (the rule document's sources section). */
export const expertiseRuleSourcesResource = defineReplica<string, RuleSource[]>({
  key: (lessonId) => lessonId,
  name: 'expertiseRuleSources',
  persist: { maxEntries: 30 },
  storage: 'indexedDB',
  version: 1,
});

/** The edits a rule has been through, per lesson id. */
export const expertiseRuleRevisionsResource = defineReplica<string, RuleRevision[]>({
  key: (lessonId) => lessonId,
  name: 'expertiseRuleRevisions',
  persist: { maxEntries: 30 },
  storage: 'indexedDB',
  version: 1,
});

/** One agent's portrait: its directions and their lessons, per agent id. */
export const expertiseOverviewResource = defineReplica<string, ExpertiseOverview>({
  key: (agentId) => agentId,
  name: 'expertiseOverview',
  persist: { maxEntries: 20 },
  storage: 'indexedDB',
  version: 1,
});

/**
 * One direction, per domain id. The server answers `null` for a direction that
 * is gone; the slice keeps that as a missing entry.
 */
export const expertiseDomainResource = defineReplica<
  string,
  ExpertiseDomainDetail,
  ExpertiseDomainDetail | null
>({
  key: (domainId) => domainId,
  name: 'expertiseDomain',
  persist: { maxEntries: 30 },
  storage: 'indexedDB',
  version: 1,
});

/**
 * One lesson with its hits, per lesson id. Hovering a habit row prefetches it,
 * so only the most recent ones survive a reload.
 */
export const expertiseLessonResource = defineReplica<
  string,
  ExpertiseLessonDetail,
  ExpertiseLessonDetail | null
>({
  key: (lessonId) => lessonId,
  name: 'expertiseLesson',
  persist: { maxEntries: 50 },
  storage: 'indexedDB',
  version: 1,
});

export const expertiseHistoryCountResource = defineReplica<string, ExpertiseHistoryCount>({
  key: (agentId) => agentId,
  name: 'expertiseHistoryCount',
  persist: { maxEntries: 20 },
  storage: 'indexedDB',
  version: 1,
});
