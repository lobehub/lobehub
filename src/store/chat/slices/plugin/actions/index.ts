import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';
import { flattenActions } from '@/store/utils/flattenActions';

import { type PluginInternalsAction } from './internals';
import { PluginInternalsActionImpl } from './internals';
import { type PluginOptimisticUpdateAction } from './optimisticUpdate';
import { PluginOptimisticUpdateActionImpl } from './optimisticUpdate';
import { type PluginTypesAction } from './pluginTypes';
import { PluginTypesActionImpl } from './pluginTypes';
import { type PluginPublicApiAction } from './publicApi';
import { PluginPublicApiActionImpl } from './publicApi';
import { type PluginWorkflowAction } from './workflow';
import { PluginWorkflowActionImpl } from './workflow';

export type ChatPluginAction = PluginPublicApiAction &
  PluginOptimisticUpdateAction &
  PluginTypesAction &
  PluginWorkflowAction &
  PluginInternalsAction;

/**
 * Combined plugin action interface
 * Aggregates all plugin-related actions
 */

/**
 * Combined plugin action creator
 * Merges all plugin action modules
 */
export const chatPlugin: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatPluginAction
> = (
  ...params: Parameters<
    StateCreator<ChatStore, [['zustand/devtools', never]], [], ChatPluginAction>
  >
) =>
  flattenActions<ChatPluginAction>([
    new PluginPublicApiActionImpl(...params),
    new PluginOptimisticUpdateActionImpl(...params),
    new PluginTypesActionImpl(...params),
    new PluginWorkflowActionImpl(...params),
    new PluginInternalsActionImpl(...params),
  ]);
