import type {
  AcceptanceCommentList,
  CreatableAcceptanceSubjectType,
  VerifyRubricConfig,
} from '@lobechat/types';
import { debounce } from 'es-toolkit/compat';
import isEqual from 'fast-deep-equal';
import { type StateCreator } from 'zustand';

import { EDITOR_DEBOUNCE_TIME, EDITOR_MAX_WAIT } from '@/const/index';
import {
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  type ReplicaPageResult,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { acceptanceCommentService } from '@/services/acceptanceComment';
import { documentService } from '@/services/document';
import type { AcceptanceBundle, AcceptanceBySubject, AcceptanceListItem } from '@/services/verify';
import { verifyService } from '@/services/verify';
import { type StoreSetter } from '@/store/types';
import { flattenActions } from '@/store/utils/flattenActions';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { initialState, type State, type VerifyCriterionEdit } from './initialState';
import {
  acceptanceBundleResource,
  acceptanceBySubjectKey,
  acceptanceBySubjectResource,
  acceptanceCommentResource,
  acceptanceListEntity,
  acceptanceListKey,
  type AcceptanceListParams,
  acceptanceListResource,
  type AcceptancePageData,
  acceptancePageKey,
  type AcceptancePageParams,
  acceptancePageResource,
  toPersistedVerifyRun,
  verifyRunResource,
  type VerifyRunSnapshot,
} from './projection';

export type Action = Pick<ActionImpl, keyof ActionImpl>;
export type Store = State & Action;

type Setter = StoreSetter<Store>;

/** `acceptanceBundleMap` / `acceptanceBySubjectMap` are plain `Record<key, value>` views. */
const acceptanceBundleLens = recordLens<Store, AcceptanceBundle>('acceptanceBundleMap');
const acceptanceBySubjectLens = recordLens<Store, AcceptanceBySubject>('acceptanceBySubjectMap');
const verifyRunLens = recordLens<Store, VerifyRunSnapshot>('verifyRunMap');
const acceptanceCommentLens = recordLens<Store, AcceptanceCommentList>('acceptanceCommentMap');
const acceptanceListLens = recordLens<Store, AcceptanceListItem[]>('acceptanceListMap');
const acceptancePageLens = recordLens<Store, AcceptancePageData>('acceptancePageMap');

/** Server page size of the list panel's scroll feed. */
export const ACCEPTANCE_PAGE_SIZE = 30;

/**
 * The workspace shell, the list panel's empty-state probe and the merge picker
 * can mount the same list read together; one request answers all of them.
 * Explicit revalidations (after a write, a retry) are not deduped.
 */
const ACCEPTANCE_LIST_DEDUPE_MS = 10_000;

/**
 * The verify store owns the write-back loop for the delivery-check config
 * portal: every control writes through `updateCriterion` / `updateInstruction`,
 * which optimistically update an in-memory overlay and debounce-persist the
 * change to the criterion row (and its instruction document) on the backend.
 */
export class ActionImpl {
  readonly #get: () => Store;
  readonly #set: Setter;
  /** The acceptance aggregate replica, behind `acceptanceBundleMap[acceptanceId]`. */
  readonly #bundle;
  /** The subject-attachment replica, behind `acceptanceBySubjectMap`. */
  readonly #bySubject;
  /** The Agent Run verify card replica, behind `verifyRunMap[operationId]`. */
  readonly #run;
  /** The flat acceptance list reads, behind `acceptanceListMap`. */
  readonly #list;
  /** The list panel's keyset feeds, behind `acceptancePageMap`. */
  readonly #page;
  /** One acceptance row in every list and feed that holds it. */
  readonly #listEntity;
  /** Each acceptance's discussion, behind `acceptanceCommentMap[acceptanceId]`. */
  readonly #comments;

  /** Pending writes coalesced per id and flushed together on a debounce. */
  #pendingCriteria = new Map<string, VerifyCriterionEdit>();
  #pendingInstructions = new Map<string, string>();
  #pendingRubricConfigs = new Map<string, VerifyRubricConfig>();
  #pendingRubricTitles = new Map<string, string>();
  #flush: ReturnType<typeof debounce>;

  constructor(set: Setter, get: () => Store, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#flush = debounce(() => this.#persist(), EDITOR_DEBOUNCE_TIME, {
      leading: false,
      maxWait: EDITOR_MAX_WAIT,
      trailing: true,
    });

    this.#bundle = createReplicaSlice(acceptanceBundleResource, {
      actionPrefix: 'acceptanceBundle',
      fetcher: (acceptanceId) => verifyService.getAcceptanceBundle(acceptanceId),
      get,
      // A poll that returns the same bundle keeps its reference, so a 5s
      // revalidation of a settled deliverable does not re-render every reader.
      merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
      set,
      stateKey: 'acceptanceBundleReplica',
      view: acceptanceBundleLens,
    });
    this.#bySubject = createReplicaSlice(acceptanceBySubjectResource, {
      actionPrefix: 'acceptanceBySubject',
      fetcher: ({ subjectId, subjectType }) =>
        verifyService.getAcceptanceBySubject(subjectType, subjectId),
      get,
      // The server answers `null` for a subject whose acceptance was deleted:
      // treat it as an explicit removal so the previous aggregate is not kept
      // (and re-persisted) by the merge.
      isMissing: (acceptance) => acceptance == null,
      merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
      set,
      stateKey: 'acceptanceBySubjectReplica',
      view: acceptanceBySubjectLens,
    });
    this.#run = createReplicaSlice(verifyRunResource, {
      actionPrefix: 'verifyRun',
      fetcher: async (operationId) => {
        const [state, results] = await Promise.all([
          verifyService.getVerifyState(operationId),
          verifyService.listResults(operationId),
        ]);
        return { results, state };
      },
      get,
      merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
      set,
      stateKey: 'verifyRunReplica',
      toPersisted: toPersistedVerifyRun,
      view: verifyRunLens,
    });
    this.#list = createReplicaSlice(acceptanceListResource, {
      actionPrefix: 'acceptanceList',
      entity: acceptanceListEntity,
      fetcher: (params) => verifyService.listAcceptances(params),
      get,
      merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
      set,
      stateKey: 'acceptanceListReplica',
      view: acceptanceListLens,
    });
    this.#page = createReplicaSlice(acceptancePageResource, {
      actionPrefix: 'acceptancePage',
      fetcher: this.#fetchAcceptancePage,
      get,
      set,
      stateKey: 'acceptancePageReplica',
      view: acceptancePageLens,
    });
    this.#listEntity = linkReplicaEntity<AcceptanceListItem>([this.#list, this.#page]);
    this.#comments = createReplicaSlice(acceptanceCommentResource, {
      actionPrefix: 'acceptanceComment',
      fetcher: (acceptanceId) => acceptanceCommentService.list(acceptanceId),
      get,
      merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
      set,
      stateKey: 'acceptanceCommentReplica',
      view: acceptanceCommentLens,
    });
  }

  /** One scroll page of the list panel: `cursor` undefined = the head (newest first). */
  #fetchAcceptancePage = async (
    params: AcceptancePageParams,
    cursor?: string,
  ): Promise<ReplicaPageResult<AcceptanceListItem, string>> => {
    const { items, nextCursor } = await verifyService.listAcceptancePage({
      ...params,
      cursor,
      limit: ACCEPTANCE_PAGE_SIZE,
    });
    return { items, nextCursor };
  };

  /**
   * Fetch orchestration only; the caller reads the rows through
   * `acceptanceListMap` (`verifySelectors.acceptanceList`). A persisted browse
   * paints first; search entries live in memory only.
   */
  useFetchAcceptanceList = (
    params: AcceptanceListParams | null,
    options: { enabled?: boolean; fresh?: boolean } = {},
  ): ReplicaSyncResult =>
    this.#list.useSync(params, {
      // A decision surface (the merge picker) asks for a fresh read on open.
      dedupingInterval: options.fresh ? 0 : ACCEPTANCE_LIST_DEDUPE_MS,
      enabled: options.enabled ?? true,
    });

  /**
   * Fetch orchestration only; the caller reads the feed through
   * `acceptancePageMap` (`verifySelectors.acceptancePage`). `null` disables the
   * feed — the panel hands off to the flat search read.
   */
  useFetchAcceptancePage = (params: AcceptancePageParams | null): ReplicaSyncResult =>
    this.#page.useSync(params, { dedupingInterval: ACCEPTANCE_LIST_DEDUPE_MS });

  /** Pull the next page of one scroll feed. */
  loadMoreAcceptancePage = async (params: AcceptancePageParams): Promise<void> => {
    await this.#page.loadMore(acceptancePageKey(params), params);
  };

  /**
   * Switching back to a feed starts again from its head page instead of the
   * depth an earlier visit had scrolled to.
   */
  collapseAcceptancePage = (params: AcceptancePageParams): void => {
    this.#page.collapse(acceptancePageKey(params));
  };

  /** Re-read every acceptance list and feed of the active scope (after any write). */
  refreshAcceptanceLists = async (): Promise<void> => {
    await Promise.all([this.#list.revalidate(), this.#page.revalidate()]);
  };

  /** Re-read one flat list entry. */
  refreshAcceptanceList = async (params: AcceptanceListParams): Promise<void> => {
    await this.#list.revalidate(acceptanceListKey(params));
  };

  /**
   * Drop deleted / merged-away acceptances from every list and feed, in memory
   * and in the persisted rows, so a reload cannot paint them back before the
   * revalidation lands.
   */
  removeAcceptancesFromLists = (acceptanceIds: string[]): void => {
    for (const id of acceptanceIds) this.#listEntity.remove(id);
  };

  /**
   * Fetch orchestration only; the caller reads the discussion through
   * `acceptanceCommentMap` (`verifySelectors.acceptanceComments`).
   */
  useFetchAcceptanceComments = (acceptanceId?: string | null): ReplicaSyncResult =>
    this.#comments.useSync(acceptanceId || null, {
      dedupingInterval: ACCEPTANCE_LIST_DEDUPE_MS,
      revalidateOnFocus: true,
    });

  /** Re-read one acceptance's discussion (after a comment write). */
  refreshAcceptanceComments = async (acceptanceId: string): Promise<void> => {
    await this.#comments.revalidate(acceptanceId);
  };

  /**
   * Apply a discussion change on screen at once and settle it with the server's
   * read-back; a failed write rolls back to the confirmed discussion.
   */
  optimisticAcceptanceComments = async (
    acceptanceId: string,
    apply: (current: AcceptanceCommentList) => AcceptanceCommentList,
    serverCall: () => Promise<unknown>,
  ): Promise<void> => {
    await this.#comments.optimistic(acceptanceId, apply, serverCall);
    await this.refreshAcceptanceComments(acceptanceId);
  };

  /** Re-read one acceptance bundle (after a review, merge, delete or status sweep). */
  refreshAcceptanceBundle = async (acceptanceId: string): Promise<void> => {
    await this.#bundle.revalidate(acceptanceId);
  };

  /** Re-read one subject's acceptance (after it is created or settled). */
  refreshAcceptanceBySubject = async (
    subjectType: CreatableAcceptanceSubjectType,
    subjectId: string,
  ): Promise<void> => {
    await this.#bySubject.revalidate(acceptanceBySubjectKey({ subjectId, subjectType }));
  };

  /**
   * Seed the persisted verify cards of a transcript before its messages mount
   * (route pre-paint), so a settled card paints in the same frame as the
   * message it belongs to instead of a few frames later.
   */
  preHydrateVerifyRuns = async (operationIds: string[]): Promise<void> => {
    if (operationIds.length === 0) return;
    const scope = verifyRunResource.scope.get();
    // The slot may still hold the previous identity's rows; drop them before seeding.
    this.#run.ensureScope(scope);
    await Promise.all(operationIds.map((operationId) => this.#run.hydrate(operationId, scope)));
  };

  /** Re-read one Agent Run's verify card (after a plan action or a manual refresh). */
  refreshVerifyRun = async (operationId: string): Promise<void> => {
    await this.#run.revalidate(operationId);
  };

  /**
   * Fetch orchestration only; the caller reads the bundle through
   * `acceptanceBundleMap` (`verifySelectors.acceptanceBundle`). `refreshInterval`
   * drives the live 5s poll of an in-flight round.
   */
  useFetchAcceptanceBundle = (
    acceptanceId?: string | null,
    options: { enabled?: boolean; refreshInterval?: number } = {},
  ): ReplicaSyncResult =>
    this.#bundle.useSync(acceptanceId || null, {
      enabled: options.enabled ?? true,
      onError: (error, { key, scope }) => {
        // A deleted (NOT_FOUND) or unauthorized (FORBIDDEN) bundle must not keep
        // rendering from the projection: drop the entry so the gate shows its
        // terminal state instead of a stale decision surface. Bind the removal to
        // the scope the failing request was captured under — an identity or
        // workspace switch while it was in flight must not let the error delete
        // the same id out of the scope that is active now.
        if (key && (isTrpcErrorCode(error, 'NOT_FOUND') || isTrpcErrorCode(error, 'FORBIDDEN'))) {
          this.#bundle.remove(key, scope);
        }
      },
      refreshInterval: options.refreshInterval,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    });

  /**
   * Fetch orchestration only; the caller reads the attachment through
   * `acceptanceBySubjectMap`. A subject without an acceptance yet keeps polling
   * so the aggregate a later verify run creates is discovered without a reload.
   */
  useFetchAcceptanceBySubject = (
    subjectType: CreatableAcceptanceSubjectType,
    subjectId?: string | null,
    options: { enabled?: boolean; refreshInterval?: number } = {},
  ): ReplicaSyncResult =>
    this.#bySubject.useSync(subjectId ? { subjectId, subjectType } : null, {
      enabled: options.enabled ?? true,
      refreshInterval: options.refreshInterval,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    });

  /**
   * Fetch orchestration only; the caller reads the card through `verifyRunMap`
   * (`verifySelectors.verifyRun`). A persisted settled run paints first and is
   * revalidated in the background.
   */
  useFetchVerifyRun = (operationId?: string | null): ReplicaSyncResult =>
    this.#run.useSync(operationId || null, {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    });

  #persist = async (): Promise<void> => {
    const criteria = [...this.#pendingCriteria.entries()];
    const instructions = [...this.#pendingInstructions.entries()];
    const rubricConfigs = [...this.#pendingRubricConfigs.entries()];
    const rubricTitles = [...this.#pendingRubricTitles.entries()];
    this.#pendingCriteria.clear();
    this.#pendingInstructions.clear();
    this.#pendingRubricConfigs.clear();
    this.#pendingRubricTitles.clear();

    await Promise.all([
      ...criteria.map(([id, value]) =>
        verifyService.updateCriterion(id, value).catch((error) => {
          console.error('[verify] failed to persist criterion', id, error);
        }),
      ),
      ...instructions.map(([id, content]) =>
        documentService.updateDocument({ content, id }).catch((error) => {
          console.error('[verify] failed to persist instruction document', id, error);
        }),
      ),
      ...rubricConfigs.map(([id, config]) =>
        verifyService.updateRubricConfig(id, config).catch((error) => {
          console.error('[verify] failed to persist rubric config', id, error);
        }),
      ),
      ...rubricTitles.map(([id, title]) =>
        verifyService.updateRubricTitle(id, title).catch((error) => {
          console.error('[verify] failed to persist rubric title', id, error);
        }),
      ),
    ]);
  };

  /** Edit one or more fields of a criterion (optimistic + debounced persist). */
  updateCriterion = (criterionId: string, patch: VerifyCriterionEdit): void => {
    const { criterionEdits } = this.#get();
    this.#set({
      criterionEdits: {
        ...criterionEdits,
        [criterionId]: { ...criterionEdits[criterionId], ...patch },
      },
    });

    this.#pendingCriteria.set(criterionId, {
      ...this.#pendingCriteria.get(criterionId),
      ...patch,
    });
    this.#flush();
  };

  /** Edit the detailed judging rubric, stored in the criterion's document. */
  updateInstruction = (documentId: string, content: string): void => {
    const { instructionEdits } = this.#get();
    this.#set({ instructionEdits: { ...instructionEdits, [documentId]: content } });

    this.#pendingInstructions.set(documentId, content);
    this.#flush();
  };

  /** Edit a rubric's run-policy config, e.g. maxRepairRounds (optimistic + debounced). */
  updateRubricConfig = (rubricId: string, patch: VerifyRubricConfig): void => {
    const { rubricConfigEdits } = this.#get();
    this.#set({
      rubricConfigEdits: {
        ...rubricConfigEdits,
        [rubricId]: { ...rubricConfigEdits[rubricId], ...patch },
      },
    });

    this.#pendingRubricConfigs.set(rubricId, {
      ...this.#pendingRubricConfigs.get(rubricId),
      ...patch,
    });
    this.#flush();
  };

  /** Rename a rubric (the delivery-standard title) — optimistic + debounced. */
  updateRubricTitle = (rubricId: string, title: string): void => {
    const { rubricTitleEdits } = this.#get();
    this.#set({ rubricTitleEdits: { ...rubricTitleEdits, [rubricId]: title } });

    this.#pendingRubricTitles.set(rubricId, title);
    this.#flush();
  };
}

export const store: StateCreator<Store> = (...parameters: Parameters<StateCreator<Store>>) => ({
  ...initialState,
  ...flattenActions<Action>([new ActionImpl(...parameters)]),
});
