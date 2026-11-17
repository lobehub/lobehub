import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { createDeveloperWebhookAction, type DeveloperWebhookAction } from './action';
import { type DeveloperWebhookState, initialDeveloperWebhookState } from './initialState';

export type DeveloperWebhookStore = DeveloperWebhookState & DeveloperWebhookAction;

const createStore: StateCreator<DeveloperWebhookStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<DeveloperWebhookStore, [['zustand/devtools', never]]>>
) => ({
  ...initialDeveloperWebhookState,
  ...flattenActions<DeveloperWebhookAction>([createDeveloperWebhookAction(...parameters)]),
});

export const useDeveloperWebhookStore = createWithEqualityFn<DeveloperWebhookStore>()(
  createDevtools('developerWebhook')(createStore),
  shallow,
);

expose('developerWebhook', useDeveloperWebhookStore);
