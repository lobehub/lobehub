import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { initialState, type StatsState } from './initialState';

const devtools = createDevtools('stats');

export const useStatsStore = createWithEqualityFn<StatsState>()(
  devtools(() => initialState),
  shallow,
);

expose('stats', useStatsStore);
