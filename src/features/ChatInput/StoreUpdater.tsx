'use client';

import { type ForwardedRef } from 'react';
import { memo, useEffect, useImperativeHandle, useLayoutEffect } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { type ChatInputEditor } from './hooks/useChatInputEditor';
import { useChatInputEditor } from './hooks/useChatInputEditor';
import { type PublicState } from './store';
import { useStoreApi } from './store';
import { DEFAULT_CHAT_INPUT_FEATURE } from './store/initialState';

export interface StoreUpdaterProps extends Partial<PublicState> {
  chatInputEditorRef?: ForwardedRef<ChatInputEditor | null>;
}

const StoreUpdater = memo<StoreUpdaterProps>(
  ({
    agentId,
    canRecordVoiceMessage,
    chatInputEditorRef,
    contextSelectionKey,
    contextWindowMessages,
    draftKey,
    feature = DEFAULT_CHAT_INPUT_FEATURE,
    mobile,
    sendButtonProps,
    leftActions,
    rightActions,
    onSend,
    onVoiceMessageSend,
    onMarkdownContentChange,
    sendMenu,
    mentionItems,
    allowExpand,
    slashPlacement,
    getMessages,
    resolveSendBlocked,
  }) => {
    const storeApi = useStoreApi();
    const useStoreUpdater = createStoreUpdater(storeApi);
    const editor = useChatInputEditor();

    useStoreUpdater('agentId', agentId);
    useStoreUpdater('canRecordVoiceMessage', canRecordVoiceMessage);
    useStoreUpdater('contextSelectionKey', contextSelectionKey);
    useStoreUpdater('contextWindowMessages', contextWindowMessages);

    // Sync draftKey before paint: the draft-transition subscriber
    // (useChatInputDraft) swaps the editor document on this change, and doing
    // it post-paint would flash the previous topic's draft for one frame.
    useLayoutEffect(() => {
      if (draftKey !== undefined && storeApi.getState().draftKey !== draftKey) {
        storeApi.setState({ draftKey });
      }
    }, [draftKey, storeApi]);
    useStoreUpdater('mobile', mobile!);
    useStoreUpdater('mentionItems', mentionItems);
    useStoreUpdater('leftActions', leftActions!);
    useStoreUpdater('rightActions', rightActions!);
    useStoreUpdater('allowExpand', allowExpand);
    useStoreUpdater('feature', feature);
    useStoreUpdater('slashPlacement', slashPlacement);
    useStoreUpdater('getMessages', getMessages);

    useStoreUpdater('sendButtonProps', sendButtonProps);
    useStoreUpdater('resolveSendBlocked', resolveSendBlocked);
    useStoreUpdater('onSend', onSend);
    useStoreUpdater('onVoiceMessageSend', onVoiceMessageSend);
    useStoreUpdater('onMarkdownContentChange', onMarkdownContentChange);

    useEffect(() => {
      // `createStoreUpdater` skips undefined values, but follow-up mode needs to
      // actively clear any previously injected send menu from the store.
      storeApi.setState({ sendMenu });
    }, [sendMenu, storeApi]);

    useImperativeHandle(chatInputEditorRef, () => editor);

    return null;
  },
);

export default StoreUpdater;
