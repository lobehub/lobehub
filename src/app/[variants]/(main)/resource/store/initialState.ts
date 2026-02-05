import type {ResourceManagerMode} from '@/features/ResourceManager';

export interface State {
  currentViewItemId?: string;
  mode: ResourceManagerMode;
  selectedFileIds: string[];
}

export const initialState: State = {
  currentViewItemId: undefined,
  mode: 'explorer',
  selectedFileIds: [],
};
