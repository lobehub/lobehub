import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';

import { type ChatCodeInterpreterAction, codeInterpreterSlice } from './interpreter';
import { type SearchAction, searchSlice } from './search';

export interface ChatBuiltinToolAction extends SearchAction, ChatCodeInterpreterAction {}

export const chatToolSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatBuiltinToolAction
> = (...params) => ({
  ...searchSlice(...params),
  ...codeInterpreterSlice(...params),
});
