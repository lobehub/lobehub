import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { createOAuthAppAction, type OAuthAppAction } from './action';
import { initialOAuthAppState, type OAuthAppState } from './initialState';

export type OAuthAppStore = OAuthAppState & OAuthAppAction;

const createStore: StateCreator<OAuthAppStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<OAuthAppStore, [['zustand/devtools', never]]>>
) => ({
  ...initialOAuthAppState,
  ...flattenActions<OAuthAppAction>([createOAuthAppAction(...parameters)]),
});

export const useOAuthAppStore = createWithEqualityFn<OAuthAppStore>()(
  createDevtools('oauthApp')(createStore),
  shallow,
);

expose('oauthApp', useOAuthAppStore);
