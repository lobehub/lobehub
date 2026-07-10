'use client';

import { ReactMentionPlugin, ReactTablePlugin, ReactToolbarPlugin } from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
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

const styles = createStaticStyles(({ css }) => ({
  desc: css`
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  editorShell: css`
    min-height: 300px;
    padding-block: 18px;
    padding-inline: 18px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  header: css`
    max-width: 820px;
  `,
  root: css`
    padding-block-end: 16px;
  `,
  title: css`
    font-size: 16px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

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
  // Guards programmatic editor writes (external Agent Builder updates) so they
  // are not mistaken for user edits — avoids latching edit-intent / acquiring
  // the lock and echoing a redundant save.
  const programmaticSyncRef = useRef(false);
  // Last systemRole pushed into the editor on the external-update (editorData
  // empty) path, so we don't re-push the same value on every render.
  const lastSyncedRoleRef = useRef<string | undefined>(undefined);

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
    // Skip programmatic external re-sync (Agent Builder updated systemRole) —
    // it's not a user edit, so don't latch edit-intent / acquire the lock or
    // echo a redundant save.
    if (programmaticSyncRef.current) return;
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
        // Record the displayed role so the external-update re-sync below doesn't
        // redundantly re-push the same value right after init.
        lastSyncedRoleRef.current = systemRole;
      }
      // If no editorData and no systemRole, leave editor empty to show placeholder
      setContentInit(true);
    } catch (error) {
      console.error('[EditorCanvas] Failed to init editor content:', error);
    }
  }, [editorInit, contentInit, editor, editorData, systemRole, streamingInProgress]);

  // Re-sync the editor when the agent's systemRole is updated EXTERNALLY — the
  // Agent Builder's updatePrompt / updateConfig clears editorData and sets a new
  // systemRole. The content-init effect above only runs ONCE, so without this an
  // external update with empty editorData leaves the editor blank even though a
  // systemRole exists. A real user edit keeps editorData populated, so gating on
  // "editorData empty" restores the original "fall back to systemRole" behavior
  // without clobbering local edits. Skipped during streaming (the streaming
  // effect owns the editor then).
  useEffect(() => {
    if (!editor || !editorInit || !contentInit) return;
    if (streamingInProgress) return;

    const hasEditorData = !!editorData && editorData?.root !== undefined;
    if (hasEditorData) {
      // Editor-backed content is the source of truth; allow a later clear to
      // re-sync from systemRole again.
      lastSyncedRoleRef.current = undefined;
      return;
    }

    const role = systemRole ?? '';
    if (lastSyncedRoleRef.current === role) return;
    lastSyncedRoleRef.current = role;

    programmaticSyncRef.current = true;
    try {
      editor.setDocument('markdown', role);
    } catch {
      // ignore
    }
    // Release the guard after the editor's onTextChange has had a chance to fire.
    const timer = setTimeout(() => {
      programmaticSyncRef.current = false;
    }, 0);
    return () => {
      clearTimeout(timer);
      programmaticSyncRef.current = false;
    };
  }, [editor, editorInit, contentInit, editorData, systemRole, streamingInProgress]);

  return (
    <Flexbox className={styles.root} gap={16}>
      <Flexbox className={styles.header} gap={4}>
        <div className={styles.title}>{t('settingAgent.prompt.title')}</div>
        <div className={styles.desc}>{t('settingAgent.prompt.desc')}</div>
      </Flexbox>
      <div
        className={styles.editorShell}
        style={
          editable ? undefined : { cursor: 'not-allowed', opacity: 0.65, pointerEvents: 'none' }
        }
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
          lineEmptyPlaceholder={t('settingAgent.prompt.editorPlaceholder')}
          mentionOption={mentionOptions}
          placeholder={t('settingAgent.prompt.editorPlaceholder')}
          style={{ paddingBottom: 0 }}
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
          onInit={() => setEditorInit(true)}
          onTextChange={handleChange}
        />
      </div>
    </Flexbox>
  );
});

export default EditorCanvas;
