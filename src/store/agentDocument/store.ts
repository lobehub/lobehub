import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { type AgentDocumentState, initialState } from './initialState';

const devtools = createDevtools('agentDocument');

export const useAgentDocumentStore = createWithEqualityFn<AgentDocumentState>()(
  devtools(() => initialState),
  shallow,
);

expose('agentDocument', useAgentDocumentStore);
