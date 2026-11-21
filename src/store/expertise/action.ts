import { cacheScope, createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { subscribeCacheScope } from '@/libs/replica/cacheScopeEvents';
import {
  type ExpertiseDomainDetail,
  type ExpertiseLessonDetail,
  type ExpertiseOverview,
  expertiseService,
  type RuleRevision,
  type RuleSource,
  type RulesOverview,
} from '@/services/expertise';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type ExpertiseState, initialState } from './initialState';
import {
  expertiseDomainResource,
  type ExpertiseHistoryCount,
  expertiseHistoryCountResource,
  expertiseLessonResource,
  expertiseOverviewResource,
  expertiseRuleRevisionsResource,
  expertiseRuleSourcesResource,
  expertiseRulesResource,
  RULES_KEY,
} from './projection';
import { useExpertiseStore } from './store';

const n = setNamespace('expertise');

type Setter = StoreSetter<ExpertiseState>;

/**
 * The portrait is read by the page header, the warm-up hook and the habit list
 * at once, and a lesson by its hover preview and its page: one request answers
 * every mounted reader. Explicit revalidations (retry, after a write) are not
 * deduped.
 */
const EXPERTISE_DEDUPE_MS = 10_000;

const SYNC_OPTIONS = { dedupingInterval: EXPERTISE_DEDUPE_MS };

const withoutKey = (map: Record<string, true>, key: string): Record<string, true> => {
  if (!map[key]) return map;
  const next = { ...map };
  delete next[key];
  return next;
};

export class ExpertiseActionImpl {
  readonly #domain;
  readonly #get: () => ExpertiseState;
  readonly #historyCount;
  readonly #lesson;
  readonly #overview;
  readonly #ruleRevisions;
  readonly #ruleSources;
  readonly #rules;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ExpertiseState) {
    this.#set = set;
    this.#get = get;

    this.#rules = createReplicaSlice(expertiseRulesResource, {
      actionPrefix: n('rules'),
      fetcher: () => expertiseService.listRules(),
      get,
      set,
      stateKey: 'rulesReplica',
      view: recordLens<ExpertiseState, RulesOverview>('rulesMap'),
    });
    this.#ruleSources = createReplicaSlice(expertiseRuleSourcesResource, {
      actionPrefix: n('ruleSources'),
      fetcher: (lessonId) => expertiseService.ruleSources(lessonId),
      get,
      set,
      stateKey: 'ruleSourcesReplica',
      view: recordLens<ExpertiseState, RuleSource[]>('ruleSourcesMap'),
    });
    this.#ruleRevisions = createReplicaSlice(expertiseRuleRevisionsResource, {
      actionPrefix: n('ruleRevisions'),
      fetcher: (lessonId) => expertiseService.ruleRevisions(lessonId),
      get,
      set,
      stateKey: 'ruleRevisionsReplica',
      view: recordLens<ExpertiseState, RuleRevision[]>('ruleRevisionsMap'),
    });
    this.#overview = createReplicaSlice(expertiseOverviewResource, {
      actionPrefix: n('overview'),
      fetcher: (agentId) => expertiseService.listByAgent(agentId),
      get,
      set,
      stateKey: 'overviewReplica',
      view: recordLens<ExpertiseState, ExpertiseOverview>('overviewMap'),
    });
    this.#domain = createReplicaSlice(expertiseDomainResource, {
      actionPrefix: n('domain'),
      fetcher: (domainId) => expertiseService.getDomain(domainId),
      get,
      // `null` is a direction that is gone: drop the entry and its persisted row.
      isMissing: (incoming) => !incoming,
      merge: (incoming) => incoming ?? undefined,
      set,
      stateKey: 'domainReplica',
      view: recordLens<ExpertiseState, ExpertiseDomainDetail>('domainMap'),
    });
    this.#lesson = createReplicaSlice(expertiseLessonResource, {
      actionPrefix: n('lesson'),
      effects: {
        onApplied: (_detail, lessonId) => this.#setLessonNotFound(lessonId, false),
        onMissing: (lessonId) => this.#setLessonNotFound(lessonId, true),
      },
      fetcher: (lessonId) => expertiseService.getLesson(lessonId),
      get,
      isMissing: (incoming) => !incoming,
      merge: (incoming) => incoming ?? undefined,
      set,
      stateKey: 'lessonReplica',
      view: recordLens<ExpertiseState, ExpertiseLessonDetail>('lessonMap'),
    });
    this.#historyCount = createReplicaSlice(expertiseHistoryCountResource, {
      actionPrefix: n('historyCount'),
      fetcher: (agentId) => expertiseService.countHistory(agentId),
      get,
      set,
      stateKey: 'historyCountReplica',
      view: recordLens<ExpertiseState, ExpertiseHistoryCount>('historyCountMap'),
    });

    // The not-found map is not a replica: a scope switch must not carry one
    // workspace's "gone" over to another that may own the same id.
    subscribeCacheScope(this.#forgetNotFoundOnScopeChange);
  }

  // ─── reads ────────────────────────────────────────────────

  /** The reviewer's rule sheet; data via `expertiseSelectors.rules`. */
  useFetchRules = (enabled = true): ReplicaSyncResult =>
    this.#rules.useSync(enabled ? RULES_KEY : null, SYNC_OPTIONS);

  useFetchRuleSources = (lessonId?: string): ReplicaSyncResult =>
    this.#ruleSources.useSync(lessonId, SYNC_OPTIONS);

  useFetchRuleRevisions = (lessonId?: string): ReplicaSyncResult =>
    this.#ruleRevisions.useSync(lessonId, SYNC_OPTIONS);

  /**
   * One agent's portrait. `refreshInterval` is only set while a history
   * warm-up is running so newly learned habits stream in without a reload.
   */
  useFetchOverview = (agentId?: string, refreshInterval?: number): ReplicaSyncResult =>
    this.#overview.useSync(agentId, { ...SYNC_OPTIONS, refreshInterval });

  useFetchDomain = (domainId?: string): ReplicaSyncResult =>
    this.#domain.useSync(domainId, SYNC_OPTIONS);

  useFetchLesson = (lessonId?: string): ReplicaSyncResult =>
    this.#lesson.useSync(lessonId, SYNC_OPTIONS);

  useFetchHistoryCount = (agentId?: string): ReplicaSyncResult =>
    this.#historyCount.useSync(agentId, SYNC_OPTIONS);

  refreshRules = async (): Promise<void> => {
    await this.#rules.fetch(RULES_KEY, { fresh: true });
  };

  refreshRuleRevisions = async (lessonId: string): Promise<void> => {
    await this.#ruleRevisions.fetch(lessonId, { fresh: true });
  };

  refreshOverview = async (agentId: string): Promise<void> => {
    await this.#overview.fetch(agentId, { fresh: true });
  };

  // ─── writes ───────────────────────────────────────────────

  /**
   * Apply `apply` to the rule sheet at once and run `serverCall`; a failed call
   * rolls the sheet back to the last confirmed value and rethrows. The sheet is
   * re-read afterwards either way, by the caller.
   */
  patchRules = <T>(
    apply: (data: RulesOverview) => RulesOverview,
    serverCall: () => Promise<T>,
  ): Promise<T> => {
    // Nothing on screen yet: there is no sheet to patch, only the call to make.
    if (!this.#get().rulesMap[RULES_KEY]) return serverCall();
    return this.#rules.optimistic(RULES_KEY, apply, serverCall);
  };

  /** Teach, revise or any portrait write that the server reshapes: re-read the portrait. */
  afterLessonWrite = async (agentId: string, lessonId?: string): Promise<void> => {
    await Promise.all([
      this.refreshOverview(agentId),
      lessonId && this.#get().lessonMap[lessonId]
        ? this.#lesson.fetch(lessonId, { fresh: true })
        : undefined,
    ]);
  };

  /** The habit drops from the portrait at once (and from its persisted copy); it returns on failure. */
  retireLesson = async (agentId: string, lessonId: string): Promise<void> => {
    await this.#optimisticOverview(
      agentId,
      (data) => ({
        ...data,
        domains: data.domains.map((d) => ({
          ...d,
          lessons: d.lessons.filter((l) => l.id !== lessonId),
        })),
      }),
      () => expertiseService.retireLesson(lessonId),
    );
    await this.afterLessonWrite(agentId, lessonId);
  };

  /** The direction drops from the portrait and its detail entry is removed with its persisted row. */
  deleteDomain = async (agentId: string, domainId: string): Promise<void> => {
    await this.#optimisticOverview(
      agentId,
      (data) => ({ ...data, domains: data.domains.filter((d) => d.id !== domainId) }),
      () => expertiseService.deleteDomain(domainId),
    );
    this.#domain.remove(domainId);
    await this.refreshOverview(agentId);
  };

  // ─── cold start ───────────────────────────────────────────

  /**
   * Seed the persisted rule sheet before the route commits (see the My rules
   * route loader): `useSync` only hydrates after mount, which would leave the
   * page on its loader for the IndexedDB read.
   */
  preHydrateRules = (): Promise<boolean> => {
    const scope = cacheScope.get();
    // The slot may still hold the previous identity's rows; drop them before seeding.
    this.#rules.ensureScope(scope);
    return this.#rules.hydrate(RULES_KEY, scope);
  };

  /** Same as `preHydrateRules`, for an agent's Self-evolving portrait. */
  preHydrateOverview = (agentId: string): Promise<boolean> => {
    const scope = cacheScope.get();
    this.#overview.ensureScope(scope);
    return this.#overview.hydrate(agentId, scope);
  };

  /** A lesson deep link (`…/experience/:lessonId`) paints its last copy before the route commits. */
  preHydrateLesson = (lessonId: string): Promise<boolean> => {
    const scope = cacheScope.get();
    this.#lesson.ensureScope(scope);
    return this.#lesson.hydrate(lessonId, scope);
  };

  reset = (): void => {
    // `clear()` drops in-flight reads of the previous data context and this
    // scope's persisted rows, so a new identity never paints the old sheet.
    for (const slice of [
      this.#domain,
      this.#historyCount,
      this.#lesson,
      this.#overview,
      this.#ruleRevisions,
      this.#ruleSources,
      this.#rules,
    ]) {
      void slice.clear();
    }
    this.#set(initialState, false, n('reset'));
  };

  #optimisticOverview = <T>(
    agentId: string,
    apply: (data: ExpertiseOverview) => ExpertiseOverview,
    serverCall: () => Promise<T>,
  ): Promise<T> => {
    if (!this.#get().overviewMap[agentId]) return serverCall();
    return this.#overview.optimistic(agentId, apply, serverCall);
  };

  #setLessonNotFound = (lessonId: string, notFound: boolean): void => {
    const current = this.#get().lessonNotFoundMap;
    if (notFound === !!current[lessonId]) return;
    this.#set(
      {
        lessonNotFoundMap: notFound
          ? { ...current, [lessonId]: true }
          : withoutKey(current, lessonId),
      },
      false,
      n('setLessonNotFound'),
    );
  };

  #forgetNotFoundOnScopeChange = (): void => {
    if (Object.keys(this.#get().lessonNotFoundMap).length === 0) return;
    this.#set({ lessonNotFoundMap: {} }, false, n('scopeChanged'));
  };
}

const { getState, setState } = useExpertiseStore;

export const expertiseActions = new ExpertiseActionImpl(setState, getState);
