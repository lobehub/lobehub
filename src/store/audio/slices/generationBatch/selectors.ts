import { type GenerationBatchState } from './initialState';

export const generationBatchesMap = (s: GenerationBatchState) => s.generationBatchesMap;

export const audioGenerationBatchSelectors = {
  generationBatchesMap,
};
