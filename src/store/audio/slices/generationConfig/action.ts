import { setNamespace } from '@/utils/storeDebug';
import { type StoreSetter } from '@/store/types';

import { type AudioStore } from '../../store';

const n = setNamespace('audioGenerationConfig');

type Setter = StoreSetter<AudioStore>;

export interface GenerationConfigAction {
  setCustomMode: (enabled: boolean) => void;
  setPrompt: (prompt: string) => void;
  setSongTitle: (title: string) => void;
  setStylePrompt: (style: string) => void;
  setMakeInstrumental: (instrumental: boolean) => void;
  setIsInit: (isInit: boolean) => void;
  /** @deprecated use setStylePrompt */
  setMusicStyle: (style: string) => void;
  /** @deprecated not used */
  setDuration: (duration: number) => void;
  /** @deprecated not used */
  setModelVersion: (version: string) => void;
}

export const createGenerationConfigSlice = (set: Setter, _get: () => AudioStore) =>
  ({
    setCustomMode: (enabled) => {
      set({ customMode: enabled }, false, n('setCustomMode'));
    },
    setPrompt: (prompt) => {
      set({ prompt }, false, n('setPrompt'));
    },
    setSongTitle: (title) => {
      set({ songTitle: title }, false, n('setSongTitle'));
    },
    setStylePrompt: (style) => {
      set({ stylePrompt: style }, false, n('setStylePrompt'));
    },
    setMakeInstrumental: (instrumental) => {
      set({ makeInstrumental: instrumental }, false, n('setMakeInstrumental'));
    },
    setIsInit: (isInit) => {
      set({ isInit }, false, n('setIsInit'));
    },
    // Legacy shims
    setMusicStyle: (style) => {
      set({ stylePrompt: style }, false, n('setMusicStyle'));
    },
    setDuration: (_duration) => {},
    setModelVersion: (_version) => {},
  }) as GenerationConfigAction;

export type { GenerationConfigAction };
