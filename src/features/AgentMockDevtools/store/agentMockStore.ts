import type { PlaybackState, SpeedMultiplier } from '@lobechat/agent-mock';
import { create } from 'zustand';

export type DevtoolsTab = 'timeline' | 'fixture';

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
  activeTab: DevtoolsTab;
  loop: boolean;
  modalOpen: boolean;
  playback: PlaybackState | null;
  popoverOpen: boolean;
  selectedCaseId: string | null;
  setActiveTab: (t: DevtoolsTab) => void;
  setLoop: (loop: boolean) => void;
  setModalOpen: (open: boolean) => void;
  setPlayback: (p: PlaybackState | null) => void;
  setPopoverOpen: (open: boolean) => void;
  setSelectedCaseId: (id: string | null) => void;
  setSpeed: (s: SpeedMultiplier) => void;
  speed: SpeedMultiplier;
}

export const useAgentMockStore = create<AgentMockStore>((set) => ({
  activeTab: 'timeline',
  loop: readPersistedLoop(),
  modalOpen: false,
  playback: null,
  popoverOpen: false,
  selectedCaseId: null,
  setActiveTab: (activeTab) => set({ activeTab }),
  setLoop: (loop) => {
    writePersistedLoop(loop);
    set({ loop });
  },
  setModalOpen: (modalOpen) => set({ modalOpen }),
  setPlayback: (playback) => set({ playback }),
  setPopoverOpen: (popoverOpen) => set({ popoverOpen }),
  setSelectedCaseId: (selectedCaseId) => set({ selectedCaseId }),
  setSpeed: (speed) => set({ speed }),
  speed: 1,
}));
