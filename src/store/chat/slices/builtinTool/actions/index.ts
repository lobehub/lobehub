import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';
import { flattenActions } from '@/store/utils/flattenActions';

import { type ChatCodeInterpreterAction, ChatCodeInterpreterActionImpl } from './interpreter';
import { type SearchAction, SearchActionImpl } from './search';

export type ChatBuiltinToolAction = SearchAction & ChatCodeInterpreterAction;

export const chatToolSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatBuiltinToolAction
> = (
  ...params: Parameters<
    StateCreator<ChatStore, [['zustand/devtools', never]], [], ChatBuiltinToolAction>
  >
) =>
  flattenActions<ChatBuiltinToolAction>([
    new SearchActionImpl(...params),
    new ChatCodeInterpreterActionImpl(...params),
  ]);
