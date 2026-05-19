import { setNamespace } from '@/utils/storeDebug';
import { type StoreSetter } from '@/store/types';

import { type AudioStore } from '../../store';
import { type AudioGenerationConfigState } from './initialState';

const n = setNamespace('generationConfig');

type Setter = StoreSetter<AudioStore>;

export interface GenerationConfigAction {
  setMusicStyle: (style: string) => void;
  setDuration: (duration: number) => void;
  setModelVersion: (version: string) => void;
  setIsInit: (isInit: boolean) => void;
}

type GenerationConfigActionImpl = GenerationConfigAction;

export const createGenerationConfigSlice = (
  set: Setter,
  get: () => AudioStore,
  _api?: unknown,
) => ({
  setMusicStyle: (style: string) => {
    set({ musicStyle: style }, false, n('setMusicStyle'));
  },

  setDuration: (duration: number) => {
    set({ duration }, false, n('setDuration'));
  },

  setModelVersion: (version: string) => {
    set({ modelVersion: version }, false, n('setModelVersion'));
  },

  setIsInit: (isInit: boolean) => {
    set({ isInit }, false, n('setIsInit'));
  },
} as GenerationConfigActionImpl);

export type { GenerationConfigAction };
