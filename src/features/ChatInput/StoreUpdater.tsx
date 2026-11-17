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
    contextWindow,
    draftKey,
    feature = DEFAULT_CHAT_INPUT_FEATURE,
    mobile,
    sendButtonProps,
    leftActions,
    rightActions,
    onSend,
    onVoiceMessageSend,
    onMarkdownContentChange,
    mentionItems,
    allowExpand,
    slashPlacement,
    getMessages,
    queueSendWhileUploading,
    resolveSendBlocked,
    topicId,
    uploadContextKey,
  }) => {
    const storeApi = useStoreApi();
    const useStoreUpdater = createStoreUpdater(storeApi);
    const editor = useChatInputEditor();

    useStoreUpdater('agentId', agentId);
    useStoreUpdater('topicId', topicId);
    useStoreUpdater('canRecordVoiceMessage', canRecordVoiceMessage);
    useStoreUpdater('contextSelectionKey', contextSelectionKey);
    useStoreUpdater('uploadContextKey', uploadContextKey);
    useStoreUpdater('contextWindow', contextWindow);

    // Sync draftKey before paint: the draft-transition subscriber
    // (useChatInputDraft) swaps the editor document on this change, and doing
    // it post-paint would flash the previous topic's draft for one frame.
    useLayoutEffect(() => {
      if (draftKey !== undefined && storeApi.getState().draftKey !== draftKey) {
        // A send queued in the conversation being left must not fire if the user
        // comes back before its uploads settle: drop it on the first switch.
        storeApi.getState().cancelUploadQueuedSend();
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
    useStoreUpdater('queueSendWhileUploading', queueSendWhileUploading);
    // A send queued for uploads watches the global file store; an unmounted
    // composer has nothing left to send it from.
    useEffect(() => () => storeApi.getState().cancelUploadQueuedSend(), [storeApi]);
    useStoreUpdater('onSend', onSend);
    useStoreUpdater('onVoiceMessageSend', onVoiceMessageSend);
    useStoreUpdater('onMarkdownContentChange', onMarkdownContentChange);

    useImperativeHandle(chatInputEditorRef, () => editor);

    return null;
  },
);

export default StoreUpdater;
