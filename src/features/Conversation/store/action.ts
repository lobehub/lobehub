import { parse } from '@lobechat/conversation-flow';
import { type UIChatMessage } from '@lobechat/types';
import { type StateCreator } from 'zustand/vanilla';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import {
  type ComposerTarget,
  type ConversationContext,
  type ConversationHooks,
  createComposerTarget,
} from '../types';
import { type State } from './initialState';
import { initialState } from './initialState';
import { type DataAction } from './slices/data/action';
import { chatTranscriptState, dataSlice } from './slices/data/action';
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
  composerTarget?: ComposerTarget;
  context: ConversationContext;
  hooks?: ConversationHooks;
  /**
   * A static transcript (a render gallery, a share snapshot). Held by this
   * store and never synced; without it the store mirrors the chat store bucket
   * of `context`, read at creation so a mount paints its rows on the first frame.
   */
  messages?: UIChatMessage[];
  skipFetch?: boolean;
}

type CreateStore = (
  params: CreateStoreParams,
) => StateCreator<Store, [['zustand/devtools', never]]>;

export const createStoreAction: CreateStore =
  ({ composerTarget, context, hooks = {}, messages, skipFetch }) =>
  (...params) => ({
    ...initialState,
    composerTarget: composerTarget ?? createComposerTarget(messageMapKey(context)),
    context,
    hooks,
    ...(messages
      ? {
          dbMessages: messages,
          displayMessages: parse(messages, undefined, { threadId: context.threadId ?? undefined })
            .flatList,
          messagesInit: true,
          skipFetch: true,
          transcriptSource: 'static' as const,
        }
      : { ...chatTranscriptState(context, skipFetch, []), skipFetch }),
    // ===== Slices =====
    ...dataSlice(...params),
    ...generationSlice(...params),
    ...inputSlice(...params),
    ...messageSlice(...params),
    ...messageEditingSlice(...params),
    ...toolSlice(...params),
    ...virtuaListSlice(...params),
  });
