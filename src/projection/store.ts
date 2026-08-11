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
import { createHomeProjectionAction, type HomeProjectionAction } from './modules/home/action';
import { createProjectionRecordAction, type ProjectionRecordAction } from './records/action';
import { projectionRepository } from './registry';

export type ProjectionAction = ProjectionCoreAction & ProjectionRecordAction & HomeProjectionAction;

export interface ProjectionStore
  extends
    ProjectionStoreState,
    ProjectionCoreAction,
    ProjectionRecordAction,
    HomeProjectionAction {}

const createStore: StateCreator<ProjectionStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<ProjectionStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<ProjectionAction>([
    createProjectionCoreAction(projectionRepository, ...parameters),
    createProjectionRecordAction(...parameters),
    createHomeProjectionAction(...parameters),
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
