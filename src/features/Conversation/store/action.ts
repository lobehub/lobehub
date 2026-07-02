import { parse } from '@lobechat/conversation-flow';
import { type UIChatMessage } from '@lobechat/types';
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
  /**
   * Messages to seed the freshly-created store with, already known by the parent
   * (ConversationArea reads them from ChatStore's `dbMessagesMap`). Seeding at
   * creation — rather than waiting for StoreUpdater's post-mount effect — is what
   * keeps a store *remount* from painting an empty/skeleton frame first.
   *
   * Why this matters: ConversationProvider keys `<Provider>` by `contextKey`, so a
   * topic switch (e.g. group's first message creates a new topic) recreates the
   * store from scratch. Without a seed the new store starts `messagesInit: false`
   * with no messages and only gets populated by a post-paint effect — one blank
   * frame, i.e. the "message disappears then reappears" flicker. `undefined` means
   * "not fetched yet" (stay uninitialized); `[]` means "loaded, empty".
   */
  initialMessages?: UIChatMessage[];
  skipFetch?: boolean;
}

type CreateStore = (
  params: CreateStoreParams,
) => StateCreator<Store, [['zustand/devtools', never]]>;

export const createStoreAction: CreateStore =
  ({ context, hooks = {}, initialMessages, skipFetch }) =>
  (...params) => ({
    ...initialState,
    context,
    hooks,
    skipFetch,
    // Seed known messages so a remount renders content on its first paint instead
    // of a blank/skeleton frame. `initialMessages` truthy ([] included) mirrors
    // StoreUpdater's `hasInitMessages = !!messages` → messagesInit semantics.
    ...(initialMessages
      ? {
          dbMessages: initialMessages,
          displayMessages: parse(initialMessages).flatList,
          messagesInit: true,
        }
      : {}),
    // ===== Slices =====
    ...dataSlice(...params),
    ...generationSlice(...params),
    ...inputSlice(...params),
    ...messageSlice(...params),
    ...messageEditingSlice(...params),
    ...toolSlice(...params),
    ...virtuaListSlice(...params),
  });
