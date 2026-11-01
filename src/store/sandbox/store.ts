import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { initialState, type SandboxState } from './initialState';

const devtools = createDevtools('sandbox');

export const useSandboxStore = createWithEqualityFn<SandboxState>()(
  devtools(() => initialState),
  shallow,
);

expose('sandbox', useSandboxStore);
