import type { StateCreator } from 'zustand/vanilla';

import type { HomeStore } from '@/store/home/store';

export interface GroupAction {
  switchToGroup: (groupId: string) => void;
}

export const createGroupSlice: StateCreator<
  HomeStore,
  [['zustand/devtools', never]],
  [],
  GroupAction
> = (_set, get) => ({
  switchToGroup: (groupId) => {
    const { navigate } = get();
    navigate?.(`/group/${groupId}`);
  },
});
