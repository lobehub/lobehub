import type { PlaybackState, SideEffectFlags, SpeedMultiplier } from '@lobechat/agent-mock';
import { DEFAULT_SIDE_EFFECT_FLAGS } from '@lobechat/agent-mock';
import { create } from 'zustand';

export type DevtoolsTab = 'player' | 'timeline' | 'fixture' | 'settings';
export type ModalState = 'closed' | 'open' | 'minimized';
export type TargetMode = 'new-topic' | 'current-topic';

export interface AgentMockStore {
  activeMockTopicId: string | null;
  activeTab: DevtoolsTab;
  // panel UI
  modalState: ModalState;
  // playback
  playback: PlaybackState | null;

  // case selection
  selectedCaseId: string | null;
  setActiveMockTopicId: (id: string | null) => void;

  setActiveTab: (t: DevtoolsTab) => void;
  setModalState: (s: ModalState) => void;
  setPlayback: (p: PlaybackState | null) => void;
  setSelectedCaseId: (id: string | null) => void;
  setSideEffects: (patch: Partial<SideEffectFlags>) => void;
  setSpeed: (s: SpeedMultiplier) => void;
  setTargetMode: (m: TargetMode) => void;
  // settings
  sideEffects: SideEffectFlags;

  speed: SpeedMultiplier;
  targetMode: TargetMode;
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
  targetMode: 'new-topic',
  setTargetMode: (targetMode) => set({ targetMode }),
  activeMockTopicId: null,
  setActiveMockTopicId: (activeMockTopicId) => set({ activeMockTopicId }),

  sideEffects: DEFAULT_SIDE_EFFECT_FLAGS,
  setSideEffects: (patch) => set((s) => ({ sideEffects: { ...s.sideEffects, ...patch } })),
}));
