import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { initialState, type LinkPreviewState } from './initialState';

const devtools = createDevtools('linkPreview');

export const useLinkPreviewStore = createWithEqualityFn<LinkPreviewState>()(
  devtools(() => initialState),
  shallow,
);

expose('linkPreview', useLinkPreviewStore);
