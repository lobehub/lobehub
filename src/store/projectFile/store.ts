import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { initialProjectFileState, type ProjectFileState } from './initialState';

const devtools = createDevtools('projectFile');

export const useProjectFileStore = createWithEqualityFn<ProjectFileState>()(
  devtools(() => initialProjectFileState),
  shallow,
);

expose('projectFile', useProjectFileStore);
