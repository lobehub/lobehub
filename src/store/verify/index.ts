'use client';

import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '@/store/middleware/createDevtools';
import { expose } from '@/store/middleware/expose';

import { type Store, store } from './action';

export type { State, VerifyCriterionEdit } from './initialState';

const devtools = createDevtools('verify');

export const useVerifyStore = createWithEqualityFn<Store>()(devtools(store), shallow);

expose('verify', useVerifyStore);

export { verifySelectors } from './selectors';
