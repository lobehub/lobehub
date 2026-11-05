import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { initialWorkState, type WorkState } from './initialState';

const devtools = createDevtools('work');

export const useWorkStore = createWithEqualityFn<WorkState>()(
  devtools(() => initialWorkState),
  shallow,
);

expose('work', useWorkStore);
