import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';

import { type PluginInternalsAction, pluginInternals } from './internals';
import {
  type PluginOptimisticUpdateAction,
  pluginOptimisticUpdate,
} from './optimisticUpdate';
import { type PluginTypesAction, pluginTypes } from './pluginTypes';
import { type PluginPublicApiAction, pluginPublicApi } from './publicApi';
import { type PluginWorkflowAction, pluginWorkflow } from './workflow';

/**
 * Combined plugin action interface
 * Aggregates all plugin-related actions
 */
export interface ChatPluginAction
  extends
    PluginPublicApiAction,
    PluginOptimisticUpdateAction,
    PluginTypesAction,
    PluginWorkflowAction,
    PluginInternalsAction {
  /**/
}

/**
 * Combined plugin action creator
 * Merges all plugin action modules
 */
export const chatPlugin: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatPluginAction
> = (...params) => ({
  ...pluginPublicApi(...params),
  ...pluginOptimisticUpdate(...params),
  ...pluginTypes(...params),
  ...pluginWorkflow(...params),
  ...pluginInternals(...params),
});
