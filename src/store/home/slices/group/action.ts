import { stableWorkspaceAwareNavigate } from '@/features/Workspace/stableWorkspaceAwareNavigate';
import { type HomeStore } from '@/store/home/store';
import { type StoreSetter } from '@/store/types';

type Setter = StoreSetter<HomeStore>;
export const createGroupSlice = (set: Setter, get: () => HomeStore, _api?: unknown) =>
  new GroupActionImpl(set, get, _api);

export class GroupActionImpl {
  constructor(set: Setter, get: () => HomeStore, _api?: unknown) {
    void _api;
    void set;
    void get;
  }

  switchToGroup = (groupId: string): void => {
    stableWorkspaceAwareNavigate(`/group/${groupId}`);
  };
}

export type GroupAction = Pick<GroupActionImpl, keyof GroupActionImpl>;
