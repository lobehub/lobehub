import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { initialMessengerState, type MessengerState } from './initialState';

const devtools = createDevtools('messenger');

export const useMessengerStore = createWithEqualityFn<MessengerState>()(
  devtools(() => initialMessengerState),
  shallow,
);

expose('messenger', useMessengerStore);
