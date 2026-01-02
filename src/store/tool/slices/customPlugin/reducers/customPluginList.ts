import { produce } from 'immer';

import { type LobeToolCustomPlugin } from '@/types/tool/plugin';

export type DevListState = LobeToolCustomPlugin[];

export type AddPluginAction = {
  plugin: LobeToolCustomPlugin;
  type: 'addItem';
};

export type DeletePluginAction = {
  id: string;
  type: 'deleteItem';
};

export type UpdatePluginAction = {
  id: string;
  plugin: LobeToolCustomPlugin;
  type: 'updateItem';
};

export type CustomPluginListDispatch = AddPluginAction | DeletePluginAction | UpdatePluginAction;

export const devPluginListReducer = (
  state: DevListState,
  payload: CustomPluginListDispatch,
): DevListState => {
  switch (payload.type) {
    case 'addItem': {
      return [...state, payload.plugin];
    }

    case 'deleteItem': {
      return produce(state, (draftState) => {
        const deleteIndex = state.findIndex((plugin) => plugin.identifier === payload.id);
        if (deleteIndex !== -1) {
          draftState.splice(deleteIndex, 1);
        }
      });
    }

    case 'updateItem': {
      return produce(state, (draftState) => {
        const updateIndex = state.findIndex((plugin) => plugin.identifier === payload.id);
        if (updateIndex !== -1) {
          draftState[updateIndex] = payload.plugin;
        }
      });
    }

    default: {
      return state;
    }
  }
};
