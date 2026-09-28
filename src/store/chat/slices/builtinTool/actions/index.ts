import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';
import { flattenActions } from '@/store/utils/flattenActions';

import { type SearchAction } from './search';
import { SearchActionImpl } from './search';

export type ChatBuiltinToolAction = SearchAction;

export const chatToolSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatBuiltinToolAction
> = (
  ...params: Parameters<
    StateCreator<ChatStore, [['zustand/devtools', never]], [], ChatBuiltinToolAction>
  >
) => flattenActions<ChatBuiltinToolAction>([new SearchActionImpl(...params)]);
