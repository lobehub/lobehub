import type { AcceptanceSubjectType, VerifyRubricConfig } from '@lobechat/types';
import { debounce } from 'es-toolkit/compat';
import isEqual from 'fast-deep-equal';
import { type StateCreator } from 'zustand';

import { EDITOR_DEBOUNCE_TIME, EDITOR_MAX_WAIT } from '@/const/index';
import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { documentService } from '@/services/document';
import type { AcceptanceBundle, AcceptanceBySubject } from '@/services/verify';
import { verifyService } from '@/services/verify';
import { type StoreSetter } from '@/store/types';
import { flattenActions } from '@/store/utils/flattenActions';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { initialState, type State, type VerifyCriterionEdit } from './initialState';
import {
  acceptanceBundleResource,
  acceptanceBySubjectKey,
  acceptanceBySubjectResource,
} from './projection';

export type Action = Pick<ActionImpl, keyof ActionImpl>;
export type Store = State & Action;

type Setter = StoreSetter<Store>;

/** `acceptanceBundleMap` / `acceptanceBySubjectMap` are plain `Record<key, value>` views. */
const acceptanceBundleLens = recordLens<Store, AcceptanceBundle>('acceptanceBundleMap');
const acceptanceBySubjectLens = recordLens<Store, AcceptanceBySubject>('acceptanceBySubjectMap');

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
  }

  /** Re-read one acceptance bundle (after a review, merge, delete or status sweep). */
  refreshAcceptanceBundle = async (acceptanceId: string): Promise<void> => {
    await this.#bundle.revalidate(acceptanceId);
  };

  /** Re-read one subject's acceptance (after it is created or settled). */
  refreshAcceptanceBySubject = async (
    subjectType: AcceptanceSubjectType,
    subjectId: string,
  ): Promise<void> => {
    await this.#bySubject.revalidate(acceptanceBySubjectKey({ subjectId, subjectType }));
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
    subjectType: AcceptanceSubjectType,
    subjectId?: string | null,
    options: { enabled?: boolean; refreshInterval?: number } = {},
  ): ReplicaSyncResult =>
    this.#bySubject.useSync(subjectId ? { subjectId, subjectType } : null, {
      enabled: options.enabled ?? true,
      refreshInterval: options.refreshInterval,
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
