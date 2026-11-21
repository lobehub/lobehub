import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { type DocumentCommentState, initialState } from './initialState';

const devtools = createDevtools('documentComment');

export const useDocumentCommentStore = createWithEqualityFn<DocumentCommentState>()(
  devtools(() => initialState),
  shallow,
);

expose('documentComment', useDocumentCommentStore);
