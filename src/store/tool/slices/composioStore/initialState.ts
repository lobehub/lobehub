import { type ComposioServer } from './types';

export interface ComposioStoreState {
  composioExecutingToolIds: Set<string>;
  composioServers: ComposioServer[];
  isComposioServersInit: boolean;
  loadingComposioServerIds: Set<string>;
}

export const initialComposioStoreState: ComposioStoreState = {
  composioExecutingToolIds: new Set(),
  composioServers: [],
  isComposioServersInit: false,
  loadingComposioServerIds: new Set(),
};
