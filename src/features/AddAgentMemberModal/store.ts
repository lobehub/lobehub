import { create } from 'zustand';

interface AgentSelectionState {
  // Actions
  clearSelection: () => void;
  isSelected: (agentId: string) => boolean;
  removeAgent: (agentId: string) => void;
  // State
  selectedAgentIds: string[];
  setSelectedAgents: (agentIds: string[]) => void;
  toggleAgent: (agentId: string) => void;
}

export const useAgentSelectionStore = create<AgentSelectionState>((set, get) => ({
  clearSelection: () => {
    set({ selectedAgentIds: [] });
  },

  isSelected: (agentId) => {
    return get().selectedAgentIds.includes(agentId);
  },

  removeAgent: (agentId) => {
    set((state) => ({
      selectedAgentIds: state.selectedAgentIds.filter((id) => id !== agentId),
    }));
  },

  selectedAgentIds: [],

  setSelectedAgents: (agentIds) => {
    set({ selectedAgentIds: agentIds });
  },

  toggleAgent: (agentId) => {
    set((state) => {
      const isCurrentlySelected = state.selectedAgentIds.includes(agentId);
      if (isCurrentlySelected) {
        return { selectedAgentIds: state.selectedAgentIds.filter((id) => id !== agentId) };
      } else {
        return { selectedAgentIds: [...state.selectedAgentIds, agentId] };
      }
    });
  },
}));
