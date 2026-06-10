'use client';

import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '@/store/middleware/createDevtools';

import { type Store, store } from './action';

export type { State, VerifyCriterionEdit } from './initialState';

const devtools = createDevtools('verify');

export const useVerifyStore = createWithEqualityFn<Store>()(devtools(store), shallow);

export { verifySelectors } from './selectors';
