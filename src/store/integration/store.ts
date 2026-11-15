import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { initialIntegrationState, type IntegrationState } from './initialState';

const devtools = createDevtools('integration');

export const useIntegrationStore = createWithEqualityFn<IntegrationState>()(
  devtools(() => initialIntegrationState),
  shallow,
);

expose('integration', useIntegrationStore);
