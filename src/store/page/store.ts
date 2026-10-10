import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { initialState, type PageState } from './initialState';

const devtools = createDevtools('page');

export const usePageStore = createWithEqualityFn<PageState>()(
  devtools(() => initialState),
  shallow,
);

expose('page', usePageStore);
