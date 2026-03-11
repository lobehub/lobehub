'use client';

import { type ForwardedRef } from 'react';
import { memo, useImperativeHandle } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { type ChatInputEditor } from './hooks/useChatInputEditor';
import { useChatInputEditor } from './hooks/useChatInputEditor';
import { type PublicState } from './store';
import { useStoreApi } from './store';

export interface StoreUpdaterProps extends Partial<PublicState> {
  chatInputEditorRef?: ForwardedRef<ChatInputEditor | null>;
}

const StoreUpdater = memo<StoreUpdaterProps>(
  ({
    agentId,
    chatInputEditorRef,
    mobile,
    sendButtonProps,
    leftActions,
    rightActions,
    onSend,
    onMarkdownContentChange,
    sendMenu,
    mentionItems,
    allowExpand,
  }) => {
    const storeApi = useStoreApi();
    const useStoreUpdater = createStoreUpdater(storeApi);
    const editor = useChatInputEditor();

    useStoreUpdater('agentId', agentId);
    useStoreUpdater('mobile', mobile!);
    useStoreUpdater('sendMenu', sendMenu!);
    useStoreUpdater('mentionItems', mentionItems);
    useStoreUpdater('leftActions', leftActions!);
    useStoreUpdater('rightActions', rightActions!);
    useStoreUpdater('allowExpand', allowExpand);

    useStoreUpdater('sendButtonProps', sendButtonProps);
    useStoreUpdater('onSend', onSend);
    useStoreUpdater('onMarkdownContentChange', onMarkdownContentChange);

    useImperativeHandle(chatInputEditorRef, () => editor);

    return null;
  },
);

export default StoreUpdater;
