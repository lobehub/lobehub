import { type HomeStore } from '@/store/home/store';
import { type StoreSetter } from '@/store/types';
import { getStableNavigate } from '@/utils/stableNavigate';

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
    getStableNavigate()?.(`/group/${groupId}`);
  };
}

export type GroupAction = Pick<GroupActionImpl, keyof GroupActionImpl>;
