import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { type AgentSignalState, initialState } from './initialState';

const devtools = createDevtools('agentSignal');

export const useAgentSignalStore = createWithEqualityFn<AgentSignalState>()(
  devtools(() => initialState),
  shallow,
);

expose('agentSignal', useAgentSignalStore);
