'use client';

import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '@/store/middleware/createDevtools';
import { expose } from '@/store/middleware/expose';

import { type Store } from './action';
import { store } from './action';

export type { PublicState, State } from './initialState';

const devtools = createDevtools('group_profile');

export const useGroupProfileStore = createWithEqualityFn<Store>()(devtools(store), shallow);

expose('groupProfile', useGroupProfileStore);

export { selectors } from './selectors';
