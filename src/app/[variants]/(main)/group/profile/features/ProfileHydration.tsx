'use client';

import { useEditor, useEditorState } from '@lobehub/editor/react';
import { useUnmount } from 'ahooks';
import { memo, useEffect } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { useRegisterFilesHotkeys, useSaveDocumentHotkey } from '@/hooks/useHotkeys';
import { parseAsString, useQueryState } from '@/hooks/useQueryParam';
import { useChatStore } from '@/store/chat';
import { useGroupProfileStore } from '@/store/groupProfile';

const ProfileHydration = memo(() => {
  const editor = useEditor();
  const editorState = useEditorState(editor);
  const flushSave = useGroupProfileStore((s) => s.flushSave);

  const storeUpdater = createStoreUpdater(useGroupProfileStore);

  // Sync editor to store
  storeUpdater('editor', editor);
  // Sync editorState to store
  storeUpdater('editorState', editorState);
  // Sync tab query param to store
  const [activeTabId] = useQueryState('tab', parseAsString.withDefault('group'));
  storeUpdater('activeTabId', activeTabId);

  // Sync URL query 'bt' → chatStore.activeTopicId (one-way only)
  // Store → URL sync is handled directly by TopicSelector using setBuilderTopicId
  const [builderTopicId] = useQueryState('bt');

  useEffect(() => {
    const urlTopicId = builderTopicId ?? undefined;
    useChatStore.setState({ activeTopicId: urlTopicId });
  }, [builderTopicId]);

  // Register hotkeys
  useRegisterFilesHotkeys();
  useSaveDocumentHotkey(flushSave);

  // Clear state when unmounting
  useUnmount(() => {
    useGroupProfileStore.setState({
      activeTabId: 'group',
      editor: undefined,
      editorState: undefined,
      saveStateMap: {},
    });
  });

  return null;
});

export default ProfileHydration;
