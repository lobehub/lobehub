'use client';

import { ReactMentionPlugin, ReactTablePlugin, ReactToolbarPlugin } from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createChatInputRichPlugins } from '@/features/ChatInput/InputEditor/plugins';
import { EditingIndicator } from '@/features/EditLock';
import { usePermission } from '@/hooks/usePermission';
import { EMPTY_EDITOR_STATE } from '@/libs/editor/constants';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { useMentionOptions } from '../ProfileEditor/MentionList';
import { useProfileStore } from '../store';
import { selectors as profileSelectors } from '../store/selectors';
import TypoBar from './TypoBar';
import { useSlashItems } from './useSlashItems';

const EditorCanvas = memo(() => {
  const { t } = useTranslation('setting');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const [editorInit, setEditorInit] = useState(false);
  const [contentInit, setContentInit] = useState(false);
  const config = useAgentStore(agentSelectors.currentAgentConfig, isEqual);
  const editorData = config?.editorData;
  const systemRole = config?.systemRole;
  const updateConfig = useAgentStore((s) => s.updateAgentConfig);
  const [initialLoad] = useState(
    editorData === undefined || editorData?.root === undefined ? EMPTY_EDITOR_STATE : editorData,
  );
  const mentionOptions = useMentionOptions();
  const editor = useProfileStore((s) => s.editor);
  const handleContentChange = useProfileStore((s) => s.handleContentChange);
  const slashItems = useSlashItems();

  // Streaming state from AgentStore
  const streamingSystemRole = useAgentStore((s) => s.streamingSystemRole);
  const streamingInProgress = useAgentStore((s) => s.streamingSystemRoleInProgress);
  const prevStreamingRef = useRef<string | undefined>(undefined);
  const wasStreamingRef = useRef(false);

  // Collaborative edit-lock state, peeked-on-open and driven by the always-mounted
  // EditLockDriver (see ../EditLockDriver) so it's resolved before this editor
  // renders — an agent another member is editing is read-only from the first frame.
  const lockedByOther = useProfileStore(profileSelectors.lockedByOther);
  const lockHolderId = useProfileStore(profileSelectors.lockHolderId);
  const lockPending = useProfileStore(profileSelectors.lockPending);
  const setHasEdited = useProfileStore((s) => s.setHasEdited);
  // Read-only until the lock resolves, so the user can't start typing on an agent
  // that turns out to be locked and get bounced mid-edit.
  const editable = canEdit && !lockedByOther && !lockPending;

  // Wrap handleContentChange with updateConfig
  const handleChange = useCallback(() => {
    if (!editable) return;
    // Don't trigger save during streaming
    if (streamingInProgress) return;
    // Latch edit-intent so the lock driver acquires the lock on the first real
    // edit. Streaming systemRole writes are programmatic and skipped above.
    setHasEdited(true);
    handleContentChange(updateConfig);
  }, [editable, handleContentChange, updateConfig, streamingInProgress, setHasEdited]);

  // Handle streaming updates - update editor with streaming content
  useEffect(() => {
    if (!editor || !editorInit) return;
    if (!streamingInProgress) {
      prevStreamingRef.current = undefined;
      return;
    }

    // Only update if content has changed
    if (streamingSystemRole !== prevStreamingRef.current) {
      prevStreamingRef.current = streamingSystemRole;
      try {
        editor.setDocument('markdown', streamingSystemRole || '');
      } catch {
        // Ignore errors during streaming updates
      }
    }
  }, [editor, editorInit, streamingSystemRole, streamingInProgress]);

  // Trigger save when streaming ends
  useEffect(() => {
    if (wasStreamingRef.current && !streamingInProgress && editor && editorInit) {
      if (!editable) return;

      // Streaming just ended, wait for editor to update its internal state then save
      // This ensures editorData (json) is properly updated from the markdown content
      const timer = setTimeout(() => {
        handleContentChange(updateConfig);
      }, 100);
      return () => clearTimeout(timer);
    }
    wasStreamingRef.current = !!streamingInProgress;
  }, [editable, streamingInProgress, editor, editorInit, handleContentChange, updateConfig]);

  useEffect(() => {
    if (!editorInit || !editor || contentInit) return;
    // Don't init if streaming is in progress
    if (streamingInProgress) return;
    try {
      if (editorData && editorData?.root !== undefined) {
        editor.setDocument('json', editorData);
      } else if (systemRole) {
        editor.setDocument('markdown', systemRole);
      }
      // If no editorData and no systemRole, leave editor empty to show placeholder
      setContentInit(true);
    } catch (error) {
      console.error('[EditorCanvas] Failed to init editor content:', error);
    }
  }, [editorInit, contentInit, editor, editorData, systemRole, streamingInProgress]);

  return (
    <div
      style={editable ? undefined : { cursor: 'not-allowed', opacity: 0.65, pointerEvents: 'none' }}
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <EditingIndicator
        holderId={lockedByOther ? lockHolderId : null}
        pending={canEdit && lockPending}
      />
      <Editor
        content={initialLoad}
        editable={editable}
        editor={editor!}
        lineEmptyPlaceholder={t('settingAgent.prompt.placeholder')}
        mentionOption={mentionOptions}
        placeholder={t('settingAgent.prompt.templatePlaceholder')}
        plugins={[
          ...createChatInputRichPlugins(),
          ReactTablePlugin,
          ReactMentionPlugin,
          Editor.withProps(ReactToolbarPlugin, {
            children: <TypoBar />,
          }),
        ]}
        slashOption={{
          items: slashItems,
        }}
        style={{
          paddingBottom: 64,
        }}
        onInit={() => setEditorInit(true)}
        onTextChange={handleChange}
      />
    </div>
  );
});

export default EditorCanvas;
