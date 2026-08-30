import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import type { StateCreator } from 'zustand/vanilla';

import { createDevtools } from '@/store/middleware/createDevtools';
import { expose } from '@/store/middleware/expose';
import { flattenActions } from '@/store/utils/flattenActions';
import { isDev } from '@/utils/env';

import { createProjectionCoreAction, type ProjectionCoreAction } from './core/action';
import { initialState, type ProjectionStoreState } from './core/initialState';
import { type AgentProjectionAction, createAgentProjectionAction } from './modules/agent/action';
import { type BriefProjectionAction, createBriefProjectionAction } from './modules/brief/action';
import { type ChatProjectionAction, createChatProjectionAction } from './modules/chat/action';
import {
  type ChatGroupProjectionAction,
  createChatGroupProjectionAction,
} from './modules/chatGroup/action';
import { createHomeProjectionAction, type HomeProjectionAction } from './modules/home/action';
import { createTaskProjectionAction, type TaskProjectionAction } from './modules/task/action';
import { createProjectionRecordAction, type ProjectionRecordAction } from './records/action';
import { projectionRepository } from './registry';

export type ProjectionAction = AgentProjectionAction &
  BriefProjectionAction &
  ChatGroupProjectionAction &
  ChatProjectionAction &
  ProjectionCoreAction &
  ProjectionRecordAction &
  HomeProjectionAction &
  TaskProjectionAction;

export interface ProjectionStore
  extends
    ProjectionStoreState,
    AgentProjectionAction,
    BriefProjectionAction,
    ChatGroupProjectionAction,
    ChatProjectionAction,
    ProjectionCoreAction,
    ProjectionRecordAction,
    HomeProjectionAction,
    TaskProjectionAction {}

const createStore: StateCreator<ProjectionStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<ProjectionStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<ProjectionAction>([
    createProjectionCoreAction(projectionRepository, ...parameters),
    createProjectionRecordAction(...parameters),
    createAgentProjectionAction(...parameters),
    createBriefProjectionAction(...parameters),
    createChatProjectionAction(...parameters),
    createChatGroupProjectionAction(...parameters),
    createHomeProjectionAction(...parameters),
    createTaskProjectionAction(...parameters),
  ]),
});

const devtools = createDevtools('projection');

export const useProjectionStore = createWithEqualityFn<ProjectionStore>()(
  subscribeWithSelector(
    devtools(createStore, {
      name: 'LobeChat_Projection' + (isDev ? '_DEV' : ''),
    }),
  ),
  shallow,
);

expose('projection', useProjectionStore);

export const getProjectionStoreState = () => useProjectionStore.getState();
