import type { VerifyRubricConfig } from '@lobechat/types';
import { debounce } from 'es-toolkit/compat';
import { type StateCreator } from 'zustand';

import { EDITOR_DEBOUNCE_TIME, EDITOR_MAX_WAIT } from '@/const/index';
import { documentService } from '@/services/document';
import { verifyService } from '@/services/verify';
import { type StoreSetter } from '@/store/types';
import { flattenActions } from '@/store/utils/flattenActions';

import { initialState, type State, type VerifyCriterionEdit } from './initialState';

export type Action = Pick<ActionImpl, keyof ActionImpl>;
export type Store = State & Action;

type Setter = StoreSetter<Store>;

/**
 * The verify store owns the write-back loop for the delivery-check config
 * portal: every control writes through `updateCriterion` / `updateInstruction`,
 * which optimistically update an in-memory overlay and debounce-persist the
 * change to the criterion row (and its instruction document) on the backend.
 */
export class ActionImpl {
  readonly #get: () => Store;
  readonly #set: Setter;

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
  }

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
