import { create } from 'zustand';

import type {
  BotChannelFilter,
  GroupBy,
  SortBy,
  StatusFilter,
  TimeRangeFilter,
  TriggerFilter,
  ViewMode,
} from './types';

interface TopicsViewState {
  botChannels: BotChannelFilter[];
  groupBy: GroupBy;
  groupIds: string[];
  search: string;
  selectedIds: string[];
  selectMode: boolean;
  sortBy: SortBy;
  status: StatusFilter;
  timeRange: TimeRangeFilter;
  triggers: TriggerFilter[];
  viewMode: ViewMode;
}

interface TopicsViewActions {
  clearSelected: () => void;
  exitSelectMode: () => void;
  reset: () => void;
  selectAll: (ids: string[]) => void;
  setBotChannels: (botChannels: BotChannelFilter[]) => void;
  setGroupBy: (groupBy: GroupBy) => void;
  setGroupIds: (groupIds: string[]) => void;
  setSearch: (search: string) => void;
  setSortBy: (sortBy: SortBy) => void;
  setStatus: (status: StatusFilter) => void;
  setTimeRange: (range: TimeRangeFilter) => void;
  setTriggers: (triggers: TriggerFilter[]) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleBotChannel: (botChannel: BotChannelFilter) => void;
  toggleSelected: (id: string) => void;
  toggleSelectMode: () => void;
  toggleTrigger: (trigger: TriggerFilter) => void;
}

const initialState: TopicsViewState = {
  botChannels: [],
  groupBy: 'byTime',
  groupIds: [],
  search: '',
  selectMode: false,
  selectedIds: [],
  sortBy: 'updatedAt',
  status: 'active',
  timeRange: 'all',
  triggers: ['chat'],
  viewMode: 'card',
};

export const useTopicsViewStore = create<TopicsViewState & TopicsViewActions>((set) => ({
  ...initialState,
  clearSelected: () => set({ selectedIds: [] }),
  exitSelectMode: () => set({ selectMode: false, selectedIds: [] }),
  reset: () => set(initialState),
  selectAll: (ids) => set({ selectedIds: ids }),
  setBotChannels: (botChannels) => set({ botChannels }),
  setGroupBy: (groupBy) => set({ groupBy }),
  setGroupIds: (groupIds) => set({ groupIds }),
  setSearch: (search) => set({ search }),
  setSortBy: (sortBy) => set({ sortBy }),
  setStatus: (status) => set({ status }),
  setTimeRange: (timeRange) => set({ timeRange }),
  setTriggers: (triggers) => set({ triggers }),
  setViewMode: (viewMode) => set({ viewMode }),
  toggleBotChannel: (botChannel) =>
    set((state) => {
      if (state.botChannels.includes(botChannel)) {
        return { botChannels: state.botChannels.filter((item) => item !== botChannel) };
      }

      return { botChannels: [...state.botChannels, botChannel], triggers: ['bot'] };
    }),
  toggleTrigger: (trigger) =>
    set((state) => {
      const removing = state.triggers.includes(trigger);
      return {
        ...(removing && trigger === 'bot' ? { botChannels: [] } : {}),
        triggers: removing
          ? state.triggers.filter((item) => item !== trigger)
          : [...state.triggers, trigger],
      };
    }),
  toggleSelectMode: () =>
    set((s) => ({ selectMode: !s.selectMode, selectedIds: s.selectMode ? [] : s.selectedIds })),
  toggleSelected: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })),
}));
