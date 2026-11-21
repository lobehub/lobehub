import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { initialState, type ResourcePermissionState } from './initialState';

const devtools = createDevtools('resourcePermission');

export const useResourcePermissionStore = createWithEqualityFn<ResourcePermissionState>()(
  devtools(() => initialState),
  shallow,
);

expose('resourcePermission', useResourcePermissionStore);
