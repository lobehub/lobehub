import type { TaskLabelWithUsage } from '@lobechat/types';

export interface TaskLabelSliceState {
  /** The label registry of the active scope (groups included), registry order. */
  taskLabels: TaskLabelWithUsage[];
  /** The registry has loaded once, so an empty array means "no labels". */
  taskLabelsInit: boolean;
  /**
   * Workspace the registry belongs to (`null` = personal). Every workspace
   * shares this one slot, so a switch must clear it before anything renders
   * the previous workspace's labels.
   */
  taskLabelsScope: string | null;
}

export const initialTaskLabelSliceState: TaskLabelSliceState = {
  taskLabels: [],
  taskLabelsInit: false,
  taskLabelsScope: null,
};
