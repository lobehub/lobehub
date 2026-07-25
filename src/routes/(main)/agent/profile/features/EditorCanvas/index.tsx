'use client';

import type { IEditor } from '@lobehub/editor';
import { ReactMentionPlugin, ReactTablePlugin, ReactToolbarPlugin } from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import InfoTooltip from '@/components/InfoTooltip';
import { createChatInputRichPlugins } from '@/features/ChatInput/InputEditor/plugins';
import { EditingIndicator } from '@/features/EditLock';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { usePermission } from '@/hooks/usePermission';
import { EMPTY_EDITOR_STATE } from '@/libs/editor/constants';
import { useAgentStore } from '@/store/agent';

import { useMentionOptions } from '../ProfileEditor/MentionList';
import { useProfileStore, useStoreApi } from '../store';
import { type UpdateConfigById } from '../store/action';
import { selectors as profileSelectors } from '../store/selectors';
import TypoBar from './TypoBar';
import { useSlashItems } from './useSlashItems';

const styles = createStaticStyles(({ css }) => ({
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
    cursor: default;
    font-size: 16px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

interface AgentEditorCanvasProps {
  agentId: string;
}

interface ProgrammaticDocument {
  format: 'json' | 'markdown';
  value: unknown;
}

const AgentEditorCanvas = memo<AgentEditorCanvasProps>(({ agentId }) => {
  const { t } = useTranslation('setting');
  const { allowed: hasEditPermission } = usePermission('edit_own_content');
  const [editorInit, setEditorInit] = useState(false);
  const [contentInit, setContentInit] = useState(false);
  const config = useAgentStore((s) => s.agentMap[agentId], isEqual);
  const editorData = config?.editorData;
  const systemRole = config?.systemRole;
  const updateConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const updatePromptConfigById = useCallback<UpdateConfigById>(
    (targetAgentId, payload) =>
      updateConfigById(targetAgentId, payload, { rethrow: true, showErrorMessage: false }),
    [updateConfigById],
  );
  const [initialLoad] = useState(
    editorData === undefined || editorData?.root === undefined ? EMPTY_EDITOR_STATE : editorData,
  );
  const mentionOptions = useMentionOptions();
  const editor = useProfileStore((s) => s.editor);
  const handleContentChange = useProfileStore((s) => s.handleContentChange);
  const slashItems = useSlashItems();

  // Streaming state from AgentStore
  const streamingSystemRoleAgentId = useAgentStore((s) => s.streamingSystemRoleAgentId);
  const streamingSystemRole = useAgentStore((s) =>
    s.streamingSystemRoleAgentId === agentId ? s.streamingSystemRole : undefined,
  );
  const streamingInProgress = useAgentStore(
    (s) => s.streamingSystemRoleAgentId === agentId && !!s.streamingSystemRoleInProgress,
  );
  const prevStreamingRef = useRef<string | undefined>(undefined);
  const wasStreamingRef = useRef(false);
  // The editor debounces onTextChange internally. Keep the exact document
  // written by code so the delayed callback can be identified by payload,
  // independent of how long that internal debounce waits.
  const programmaticDocumentRef = useRef<ProgrammaticDocument | undefined>(undefined);
  // Local edit intent is scoped by this keyed component instance. A later
  // server revalidation may replace hydrated/stale editor data until the user
  // actually types, but must never clobber an in-progress local draft.
  const localEditRef = useRef(false);
  const lastSyncedEditorDataRef = useRef<unknown>(undefined);
  // Last systemRole pushed into the editor on the external-update (editorData
  // empty) path, so we don't re-push the same value on every render.
  const lastSyncedRoleRef = useRef<string | undefined>(undefined);

  // Collaborative edit-lock state, peeked-on-open and driven by the always-mounted
  // EditLockDriver (see ../EditLockDriver) so it's resolved before this editor
  // renders — an agent another member is editing is read-only from the first frame.
  const lockedByOther = useProfileStore(profileSelectors.lockedByOther);
  const lockHolderId = useProfileStore(profileSelectors.lockHolderId);
  const lockPending = useProfileStore(profileSelectors.lockPending);
  const promptLastUpdatedTime = useProfileStore(profileSelectors.promptLastUpdatedTime);
  const promptSaveStatus = useProfileStore(profileSelectors.promptSaveStatus);
  const retryPromptSave = useProfileStore((s) => s.retryPromptSave);
  const setHasEdited = useProfileStore((s) => s.setHasEdited);
  // A workspace member whose General access on this agent is view/use level
  // can't edit the prompt (defaults permissive while loading — server enforces).
  const { canEditResource } = useResourceAccess(
    'agent',
    config?.visibility === 'private' ? undefined : agentId,
  );
  const canEdit = hasEditPermission && canEditResource;
  // Read-only until the lock resolves, so the user can't start typing on an agent
  // that turns out to be locked and get bounced mid-edit.
  const editable = canEdit && !lockedByOther && !lockPending;

  const recordProgrammaticDocument = useCallback(
    (sourceEditor: IEditor, format: ProgrammaticDocument['format']) => {
      try {
        programmaticDocumentRef.current = {
          format,
          value: structuredClone(sourceEditor.getDocument(format)),
        };
      } catch {
        programmaticDocumentRef.current = undefined;
      }
    },
    [],
  );

  const isProgrammaticChange = useCallback(
    (sourceEditor?: IEditor) => {
      const pendingDocument = programmaticDocumentRef.current;
      const changedEditor = sourceEditor ?? editor;
      if (!pendingDocument || !changedEditor) return false;

      programmaticDocumentRef.current = undefined;
      try {
        return isEqual(changedEditor.getDocument(pendingDocument.format), pendingDocument.value);
      } catch {
        return false;
      }
    },
    [editor],
  );

  // Wrap handleContentChange with updateConfig
  const handleChange = useCallback(
    (sourceEditor?: IEditor) => {
      // Programmatic setDocument calls arrive through the editor's own delayed
      // onTextChange callback. Compare payloads instead of relying on a timer.
      if (isProgrammaticChange(sourceEditor)) return;
      if (!editable) return;
      // Don't trigger save during streaming
      if (streamingInProgress) return;
      // Latch edit-intent so the lock driver acquires the lock on the first real
      // edit. Streaming systemRole writes are programmatic and skipped above.
      localEditRef.current = true;
      setHasEdited(true);
      handleContentChange(agentId, updatePromptConfigById, sourceEditor);
    },
    [
      agentId,
      editable,
      handleContentChange,
      isProgrammaticChange,
      setHasEdited,
      streamingInProgress,
      updatePromptConfigById,
    ],
  );

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
        recordProgrammaticDocument(editor, 'markdown');
      } catch {
        // Ignore errors during streaming updates
      }
    }
  }, [editor, editorInit, recordProgrammaticDocument, streamingInProgress, streamingSystemRole]);

  // Trigger save when streaming ends
  useEffect(() => {
    if (wasStreamingRef.current && !streamingInProgress && editor && editorInit) {
      // The current agent's stream was superseded by another agent's stream.
      // Do not treat that ownership transfer as a completed local stream.
      if (streamingSystemRoleAgentId && streamingSystemRoleAgentId !== agentId) {
        wasStreamingRef.current = false;
        return;
      }
      if (!editable) return;

      // Streaming just ended, wait for editor to update its internal state then save
      // This ensures editorData (json) is properly updated from the markdown content
      const timer = setTimeout(() => {
        handleContentChange(agentId, updatePromptConfigById);
      }, 100);
      return () => clearTimeout(timer);
    }
    wasStreamingRef.current = !!streamingInProgress;
  }, [
    agentId,
    editable,
    editor,
    editorInit,
    handleContentChange,
    streamingSystemRoleAgentId,
    streamingInProgress,
    updatePromptConfigById,
  ]);

  useEffect(() => {
    if (!editorInit || !editor || contentInit) return;
    // Don't init if streaming is in progress
    if (streamingInProgress) return;
    try {
      if (editorData && editorData?.root !== undefined) {
        editor.setDocument('json', editorData);
        recordProgrammaticDocument(editor, 'json');
        lastSyncedEditorDataRef.current = structuredClone(editorData);
      } else if (systemRole) {
        editor.setDocument('markdown', systemRole);
        recordProgrammaticDocument(editor, 'markdown');
        // Record the displayed role so the external-update re-sync below doesn't
        // redundantly re-push the same value right after init.
        lastSyncedRoleRef.current = systemRole;
      }
      // If no editorData and no systemRole, leave editor empty to show placeholder
      setContentInit(true);
    } catch (error) {
      console.error('[EditorCanvas] Failed to init editor content:', error);
    }
  }, [
    contentInit,
    editor,
    editorData,
    editorInit,
    recordProgrammaticDocument,
    streamingInProgress,
    systemRole,
  ]);

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
      lastSyncedRoleRef.current = undefined;
      // A fresh server response is authoritative while this agent has not been
      // edited locally. This replaces stale persisted/hydrated editor data, but
      // preserves the user's current draft once they have typed.
      if (localEditRef.current || isEqual(lastSyncedEditorDataRef.current, editorData)) return;

      try {
        editor.setDocument('json', editorData);
        recordProgrammaticDocument(editor, 'json');
        lastSyncedEditorDataRef.current = structuredClone(editorData);
      } catch (error) {
        console.error('[EditorCanvas] Failed to sync editor content:', error);
      }
      return;
    }

    lastSyncedEditorDataRef.current = undefined;
    const role = systemRole ?? '';
    if (lastSyncedRoleRef.current === role) return;
    lastSyncedRoleRef.current = role;

    try {
      editor.setDocument('markdown', role);
      recordProgrammaticDocument(editor, 'markdown');
    } catch {
      // ignore
    }
  }, [
    contentInit,
    editor,
    editorData,
    editorInit,
    recordProgrammaticDocument,
    streamingInProgress,
    systemRole,
  ]);

  return (
    <Flexbox className={styles.root} gap={16}>
      <Flexbox className={styles.header} gap={4}>
        <Flexbox horizontal align={'center'} distribution={'space-between'} gap={8}>
          <Flexbox horizontal align={'center'} gap={6}>
            <div className={styles.title}>{t('settingAgent.prompt.title')}</div>
            <InfoTooltip
              iconStyle={{ cursor: 'help' }}
              size={'small'}
              title={t('settingAgent.prompt.desc')}
            />
          </Flexbox>
          {promptSaveStatus !== 'idle' && (
            <AutoSaveHint
              lastUpdatedTime={promptLastUpdatedTime}
              saveStatus={promptSaveStatus}
              onRetry={editable ? () => void retryPromptSave() : undefined}
            />
          )}
        </Flexbox>
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

const EditorCanvas = memo(() => {
  const { t } = useTranslation();
  const agentId = useAgentStore((s) => s.activeAgentId);
  const flushSave = useProfileStore((s) => s.flushSave);
  // Capture the store API in the cleanup closure so the final status check
  // still works after this provider/editor unmounts.
  const storeApi = useStoreApi();

  // Flush the departing agent's own debouncer before this keyed editor is
  // replaced. The store keeps the save target and payload isolated by agentId.
  // After unmount AutoSaveHint is gone, so a failed flush must fall back to a
  // global toast. This is reliable because flushSave awaits saveQueue, and
  // enqueueSave writes promptSaveStatus: 'failed' before the queue promise
  // resolves — with no further revision overwrites after unmount.
  useEffect(
    () => () => {
      if (!agentId) return;
      void flushSave(agentId).then(() => {
        if (storeApi.getState().promptSaveStatus === 'failed') {
          message.error(t('saveAgentConfigFail', { ns: 'common' }));
        }
      });
    },
    [agentId, flushSave, storeApi, t],
  );

  if (!agentId) return null;

  return <AgentEditorCanvas agentId={agentId} key={agentId} />;
});

export default EditorCanvas;
