'use client';

import { useEditor, useEditorState } from '@lobehub/editor/react';
import { useUnmount } from 'ahooks';
import { memo, useEffect, useRef } from 'react';
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

  // Bidirectional sync between URL query 'bt' and chatStore.activeTopicId
  const [builderTopicId, setBuilderTopicId] = useQueryState('bt');
  const activeTopicId = useChatStore((s) => s.activeTopicId);

  // Track if the change came from URL to prevent sync loops
  const isUrlChangeRef = useRef(false);

  // Sync URL → Store (when URL changes)
  useEffect(() => {
    const urlTopicId = builderTopicId ?? undefined;
    if (urlTopicId !== activeTopicId) {
      isUrlChangeRef.current = true;
      useChatStore.setState({ activeTopicId: urlTopicId });
    }
  }, [builderTopicId]);

  // Sync Store → URL (when store changes, but not from URL)
  useEffect(() => {
    if (isUrlChangeRef.current) {
      isUrlChangeRef.current = false;
      return;
    }
    const urlTopicId = builderTopicId ?? undefined;
    if (activeTopicId !== urlTopicId) {
      setBuilderTopicId(activeTopicId ?? null);
    }
  }, [activeTopicId]);

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
    useChatStore.setState({ activeTopicId: undefined });
  });

  return null;
});

export default ProfileHydration;
