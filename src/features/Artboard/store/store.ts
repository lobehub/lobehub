import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '@/store/middleware/createDevtools';

import { type ArtboardState, initialState } from './initialState';

const devtools = createDevtools('artboard');

export const useArtboardStore = createWithEqualityFn<ArtboardState>()(
  devtools(() => initialState),
  shallow,
);
