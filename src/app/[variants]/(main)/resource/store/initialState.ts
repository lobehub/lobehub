import { type ResouceManagerMode } from '@/features/ResourceManager';

export interface State {
  currentViewItemId?: string;
  mode: ResouceManagerMode;
  selectedFileIds: string[];
}

export const initialState: State = {
  currentViewItemId: undefined,
  mode: 'explorer',
  selectedFileIds: [],
};
