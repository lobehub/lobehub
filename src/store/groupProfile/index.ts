'use client';

import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '@/store/middleware/createDevtools';

import { type Store, store } from './action';

export type { PublicState, State } from './initialState';

const devtools = createDevtools('group_profile');

export const useGroupProfileStore = createWithEqualityFn<Store>()(devtools(store), shallow);

export { selectors } from './selectors';
