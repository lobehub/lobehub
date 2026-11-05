import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { initialState, type MiniGameState } from './initialState';

const devtools = createDevtools('miniGame');

export const useMiniGameStore = createWithEqualityFn<MiniGameState>()(
  devtools(() => initialState),
  shallow,
);

expose('miniGame', useMiniGameStore);
