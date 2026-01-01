import { type CustomSessionGroup, type LobeSessionGroups } from '@/types/session';

export interface SessionGroupState {
  customSessionGroups: CustomSessionGroup[];
  sessionGroupRenamingId: string | null;
  /**
   * @title 正在更新的分组 ID
   * @description 用于显示分组更新时的加载状态
   */
  sessionGroupUpdatingId: string | null;
  sessionGroups: LobeSessionGroups;
}

export const initSessionGroupState: SessionGroupState = {
  customSessionGroups: [],
  sessionGroupRenamingId: null,
  sessionGroupUpdatingId: null,
  sessionGroups: [],
};
