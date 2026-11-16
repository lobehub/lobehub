import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { type EntityPreviewState, initialState } from './initialState';

const devtools = createDevtools('entityPreview');

export const useEntityPreviewStore = createWithEqualityFn<EntityPreviewState>()(
  devtools(() => initialState),
  shallow,
);

expose('entityPreview', useEntityPreviewStore);
