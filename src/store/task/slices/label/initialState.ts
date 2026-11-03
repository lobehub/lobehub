import type { TaskLabelWithUsage } from '@lobechat/types';

export interface TaskLabelSliceState {
  /** The label registry of the active scope (groups included), registry order. */
  taskLabels: TaskLabelWithUsage[];
  /** The registry has loaded once, so an empty array means "no labels". */
  taskLabelsInit: boolean;
}

export const initialTaskLabelSliceState: TaskLabelSliceState = {
  taskLabels: [],
  taskLabelsInit: false,
};
