import { type CreateAudioState } from './initialState';

export interface CreateAudioAction {}

type Setter = any;

export const createCreateAudioSlice = (set: Setter, get: () => any, _api?: unknown) =>
  ({} as CreateAudioAction);

export type { CreateAudioAction };
