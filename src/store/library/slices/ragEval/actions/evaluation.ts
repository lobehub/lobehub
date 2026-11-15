import { type CreateNewEvalEvaluation } from '@lobechat/types';

import { mutate } from '@/libs/swr';
import { ragEvalKeys } from '@/libs/swr/keys';
import { ragEvalService } from '@/services/ragEval';
import { type KnowledgeBaseStore } from '@/store/library/store';
import { type StoreSetter } from '@/store/types';

type Setter = StoreSetter<KnowledgeBaseStore>;
export const createRagEvalEvaluationSlice = (
  set: Setter,
  get: () => KnowledgeBaseStore,
  _api?: unknown,
) => new RAGEvalEvaluationActionImpl(set, get, _api);

export class RAGEvalEvaluationActionImpl {
  readonly #get: () => KnowledgeBaseStore;

  constructor(_set: Setter, get: () => KnowledgeBaseStore, _api?: unknown) {
    void _set;
    void _api;
    this.#get = get;
  }

  checkEvaluationStatus = async (id: string): Promise<void> => {
    await ragEvalService.checkEvaluationStatus(id);
  };

  createNewEvaluation = async (params: CreateNewEvalEvaluation): Promise<void> => {
    await ragEvalService.createEvaluation(params);
    await this.#get().refreshEvaluationList();
  };

  refreshEvaluationList = async (): Promise<void> => {
    await mutate(ragEvalKeys.evaluationList());
  };

  removeEvaluation = async (id: string): Promise<void> => {
    await ragEvalService.removeEvaluation(id);
    // await this.#get().refreshEvaluationList();
  };

  runEvaluation = async (id: string): Promise<void> => {
    await ragEvalService.startEvaluationTask(id);
  };
}

export type RAGEvalEvaluationAction = Pick<
  RAGEvalEvaluationActionImpl,
  keyof RAGEvalEvaluationActionImpl
>;
