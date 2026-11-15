import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { initialState, type MeetingState } from './initialState';

const devtools = createDevtools('meeting');

export const useMeetingStore = createWithEqualityFn<MeetingState>()(
  devtools(() => initialState),
  shallow,
);

expose('meeting', useMeetingStore);
