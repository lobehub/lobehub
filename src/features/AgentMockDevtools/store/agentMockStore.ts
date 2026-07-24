import type { PlaybackState, SpeedMultiplier } from '@lobechat/agent-mock';
import { create } from 'zustand';

const LOOP_STORAGE_KEY = 'LOBE_AGENT_MOCK_LOOP';

const readPersistedLoop = (): boolean => {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(LOOP_STORAGE_KEY) === '1';
};

const writePersistedLoop = (next: boolean) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LOOP_STORAGE_KEY, next ? '1' : '0');
};

export interface AgentMockStore {
  loop: boolean;
  playback: PlaybackState | null;
  selectedCaseId: string | null;
  setLoop: (loop: boolean) => void;
  setPlayback: (p: PlaybackState | null) => void;
  setSelectedCaseId: (id: string | null) => void;
  setSpeed: (s: SpeedMultiplier) => void;
  speed: SpeedMultiplier;
}

export const useAgentMockStore = create<AgentMockStore>((set) => ({
  loop: readPersistedLoop(),
  playback: null,
  selectedCaseId: null,
  setLoop: (loop) => {
    writePersistedLoop(loop);
    set({ loop });
  },
  setPlayback: (playback) => set({ playback }),
  setSelectedCaseId: (selectedCaseId) => set({ selectedCaseId }),
  setSpeed: (speed) => set({ speed }),
  speed: 1,
}));
