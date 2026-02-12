import { type StateCreator } from 'zustand/vanilla';

import { type ConversationContext, type ConversationHooks } from '../types';
import { type State } from './initialState';
import { initialState } from './initialState';
import { type DataAction } from './slices/data/action';
import { dataSlice } from './slices/data/action';
import { type GenerationAction } from './slices/generation/action';
import { generationSlice } from './slices/generation/action';
import { type InputAction } from './slices/input/action';
import { inputSlice } from './slices/input/action';
import { type MessageAction } from './slices/message/action';
import { messageSlice } from './slices/message/action';
import { type MessageEditingAction } from './slices/messageState/action';
import { messageEditingSlice } from './slices/messageState/action';
import { type ToolAction } from './slices/tool/action';
import { toolSlice } from './slices/tool/action';
import { type VirtuaListAction } from './slices/virtuaList/action';
import { virtuaListSlice } from './slices/virtuaList/action';

// ===== Combined Store Type =====

export type Store = State &
  DataAction &
  GenerationAction &
  InputAction &
  MessageAction &
  MessageEditingAction &
  ToolAction &
  VirtuaListAction;

// Alias for backward compatibility
export type ConversationStore = Store;

// ===== Store Creator =====

export interface CreateStoreParams {
  context: ConversationContext;
  hooks?: ConversationHooks;
  skipFetch?: boolean;
}

type CreateStore = (
  params: CreateStoreParams,
) => StateCreator<Store, [['zustand/devtools', never]]>;

export const createStoreAction: CreateStore =
  ({ context, hooks = {}, skipFetch }) =>
  (...params) => ({
    ...initialState,
    context,
    hooks,
    skipFetch,
    // ===== Slices =====
    ...dataSlice(...params),
    ...generationSlice(...params),
    ...inputSlice(...params),
    ...messageSlice(...params),
    ...messageEditingSlice(...params),
    ...toolSlice(...params),
    ...virtuaListSlice(...params),
  });
