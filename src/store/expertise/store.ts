import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { type ExpertiseState, initialState } from './initialState';

const devtools = createDevtools('expertise');

export const useExpertiseStore = createWithEqualityFn<ExpertiseState>()(
  devtools(() => initialState),
  shallow,
);

expose('expertise', useExpertiseStore);
