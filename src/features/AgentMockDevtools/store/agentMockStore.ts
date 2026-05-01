import type { PlaybackState, SpeedMultiplier } from '@lobechat/agent-mock';
import { create } from 'zustand';

export type DevtoolsTab = 'player' | 'timeline' | 'fixture';
export type ModalState = 'closed' | 'open' | 'minimized';

export interface AgentMockStore {
  activeTab: DevtoolsTab;
  // panel UI
  modalState: ModalState;
  // playback
  playback: PlaybackState | null;

  // case selection
  selectedCaseId: string | null;

  setActiveTab: (t: DevtoolsTab) => void;
  setModalState: (s: ModalState) => void;
  setPlayback: (p: PlaybackState | null) => void;
  setSelectedCaseId: (id: string | null) => void;
  setSpeed: (s: SpeedMultiplier) => void;

  speed: SpeedMultiplier;
}

export const useAgentMockStore = create<AgentMockStore>((set) => ({
  modalState: 'closed',
  activeTab: 'player',
  setModalState: (modalState) => set({ modalState }),
  setActiveTab: (activeTab) => set({ activeTab }),

  selectedCaseId: null,
  setSelectedCaseId: (selectedCaseId) => set({ selectedCaseId }),

  playback: null,
  setPlayback: (playback) => set({ playback }),
  speed: 1,
  setSpeed: (speed) => set({ speed }),
}));
