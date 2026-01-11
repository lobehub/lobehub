'use client';

import { useEditor, useEditorState } from '@lobehub/editor/react';
import { useUnmount } from 'ahooks';
import { memo } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { useRegisterFilesHotkeys, useSaveDocumentHotkey } from '@/hooks/useHotkeys';
import { parseAsString, useQueryState } from '@/hooks/useQueryParam';
import { useChatStore } from '@/store/chat';

import { useProfileStore } from '../store';

const ProfileHydration = memo(() => {
  const editor = useEditor();
  const editorState = useEditorState(editor);
  const flushSave = useProfileStore((s) => s.flushSave);

  const storeUpdater = createStoreUpdater(useProfileStore);
  const chatStoreUpdater = createStoreUpdater(useChatStore);

  // Sync editor to store
  storeUpdater('editor', editor);
  // Sync editorState to store
  storeUpdater('editorState', editorState);
  // Sync tab query param to store
  const [activeTabId] = useQueryState('tab', parseAsString.withDefault('group'));
  storeUpdater('activeTabId', activeTabId);

  // Sync builder topic query param (bt) to chatStore.activeTopicId
  const [builderTopicId] = useQueryState('bt');
  chatStoreUpdater('activeTopicId', builderTopicId ?? undefined);

  // Register hotkeys
  useRegisterFilesHotkeys();
  useSaveDocumentHotkey(flushSave);

  // Clear state when unmounting
  useUnmount(() => {
    useProfileStore.setState({
      activeTabId: 'group',
      editor: undefined,
      editorState: undefined,
    });
    useChatStore.setState({ activeTopicId: undefined });
  });

  return null;
});

export default ProfileHydration;
