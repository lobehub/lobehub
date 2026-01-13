'use client';

import { useEditor, useEditorState } from '@lobehub/editor/react';
import { useUnmount } from 'ahooks';
import { memo } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import {
  useBidirectionalQuerySync,
  useBidirectionalQuerySyncOptional,
} from '@/hooks/useBidirectionalQuerySync';
import { useRegisterFilesHotkeys, useSaveDocumentHotkey } from '@/hooks/useHotkeys';
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

  // Bidirectional sync between URL query 'tab' and groupProfileStore.activeTabId
  const activeTabId = useGroupProfileStore((s) => s.activeTabId);
  useBidirectionalQuerySync(
    'tab',
    activeTabId,
    (value) => useGroupProfileStore.setState({ activeTabId: value }),
    { defaultValue: 'group' },
  );

  // Bidirectional sync between URL query 'bt' and chatStore.activeTopicId
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  useBidirectionalQuerySyncOptional('bt', activeTopicId, (value) =>
    useChatStore.setState({ activeTopicId: value }),
  );

  // Register hotkeys
  useRegisterFilesHotkeys();
  useSaveDocumentHotkey(flushSave);

  // Clear state when unmounting
  useUnmount(() => {
    useGroupProfileStore.setState({
      activeTabId: 'group',
      editor: undefined,
      editorState: undefined,
    });
    useChatStore.setState({ activeTopicId: undefined });
  });

  return null;
});

export default ProfileHydration;
