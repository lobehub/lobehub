'use client';

import type { IEditor } from '@lobehub/editor';
import { ReactMentionPlugin, ReactTablePlugin, ReactToolbarPlugin } from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { ActionIcon, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { CodeXmlIcon, LetterTextIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CodeEditorPane from '@/components/CodeEditorPane';
import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import InfoTooltip from '@/components/InfoTooltip';
import { createChatInputRichPlugins } from '@/features/ChatInput/InputEditor/plugins';
import { EditingIndicator } from '@/features/EditLock';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
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
  root: css`
    padding-block-end: 16px;
  `,
  sourceEditor: css`
    min-height: 262px;
    background: transparent;
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

type PromptEditorMode = 'source' | 'visual';

const PROMPT_EDITOR_MODE_STORAGE_KEY = 'agent-profile-prompt-editor-mode';

const usePromptEditorMode = () => {
  const [editorMode, setEditorMode] = useLocalStorageState<PromptEditorMode>(
    PROMPT_EDITOR_MODE_STORAGE_KEY,
    'visual',
  );
  const [sourceMarkdown, setSourceMarkdown] = useState('');

  const syncSourceMarkdown = useCallback((sourceEditor: IEditor) => {
    try {
      setSourceMarkdown((sourceEditor.getDocument('markdown') as unknown as string) || '');
    } catch {
      // Keep the last readable source value if the editor is between document states.
    }
  }, []);

  return {
    // localStorage holds unvalidated JSON, so fall back to the visual editor for
    // any value that isn't a known mode — otherwise both render branches miss and
    // the editor shell renders empty.
    activeEditorMode: editorMode === 'source' ? 'source' : 'visual',
    setEditorMode,
    setSourceMarkdown,
    sourceMarkdown,
    syncSourceMarkdown,
  } as const;
};

const AgentEditorCanvas = memo<AgentEditorCanvasProps>(({ agentId }) => {
  const { t } = useTranslation('setting');
  const { allowed: hasEditPermission } = usePermission('edit_own_content');
  const [editorInit, setEditorInit] = useState(false);
  const [contentInit, setContentInit] = useState(false);
  const { activeEditorMode, setEditorMode, setSourceMarkdown, sourceMarkdown, syncSourceMarkdown } =
    usePromptEditorMode();
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
  // CodeMirror emits `change` for controlled `setValue` calls as well as user
  // edits. Remember the next value pushed from props so that callback does not
  // acquire the edit lock or enqueue an autosave.
  const programmaticSourceChangeRef = useRef<string | undefined>(undefined);
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

  /**
   * Writes a document into the editor and keeps the source pane's Markdown in sync.
   *
   * @param markdownSource - The exact Markdown to show in source mode. Pass the
   *   persisted `systemRole` whenever it exists: `getDocument('markdown')` is a
   *   lossy re-serialization, so deriving the source here would replace the user's
   *   raw Markdown with the editor's normalized rendering — and the next source-mode
   *   keystroke would persist that normalized text. Nullish (no persisted source)
   *   falls back to the editor's own, normalized Markdown.
   *   See source mode toggle in agent profile core instructions editor / lobehub/lobehub#17580.
   */
  const setProgrammaticDocument = useCallback(
    (
      sourceEditor: IEditor,
      format: ProgrammaticDocument['format'],
      value: unknown,
      markdownSource?: string | null,
    ) => {
      sourceEditor.setDocument(format, value);
      recordProgrammaticDocument(sourceEditor, format);
      if (markdownSource == null) {
        try {
          const nextSource = (sourceEditor.getDocument('markdown') as unknown as string) || '';
          programmaticSourceChangeRef.current = nextSource;
          setSourceMarkdown(nextSource);
        } catch {
          // Keep the last readable source value if the editor is between document states.
        }
      } else {
        programmaticSourceChangeRef.current = markdownSource;
        setSourceMarkdown(markdownSource);
      }
    },
    [recordProgrammaticDocument, setSourceMarkdown],
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
      if (sourceEditor) syncSourceMarkdown(sourceEditor);
      handleContentChange(agentId, updatePromptConfigById, sourceEditor);
    },
    [
      agentId,
      editable,
      handleContentChange,
      isProgrammaticChange,
      setHasEdited,
      syncSourceMarkdown,
      streamingInProgress,
      updatePromptConfigById,
    ],
  );

  const handleSourceChange = useCallback(
    (value: string) => {
      const programmaticValue = programmaticSourceChangeRef.current;
      if (programmaticValue !== undefined) {
        programmaticSourceChangeRef.current = undefined;
        if (programmaticValue === value) return;
      }

      setSourceMarkdown(value);
      if (!editor || !editable || streamingInProgress) return;

      localEditRef.current = true;
      setHasEdited(true);
      try {
        editor.setDocument('markdown', value);
        recordProgrammaticDocument(editor, 'markdown');
        handleContentChange(agentId, updatePromptConfigById, editor, value);
      } catch (error) {
        console.error('[EditorCanvas] Failed to update Markdown source:', error);
      }
    },
    [
      agentId,
      editable,
      editor,
      handleContentChange,
      recordProgrammaticDocument,
      setHasEdited,
      setSourceMarkdown,
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
        const markdown = streamingSystemRole || '';
        setProgrammaticDocument(editor, 'markdown', markdown, markdown);
      } catch {
        // Ignore errors during streaming updates
      }
    }
  }, [editor, editorInit, setProgrammaticDocument, streamingInProgress, streamingSystemRole]);

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
        setProgrammaticDocument(editor, 'json', editorData, systemRole);
        lastSyncedEditorDataRef.current = structuredClone(editorData);
      } else if (systemRole) {
        setProgrammaticDocument(editor, 'markdown', systemRole, systemRole);
        // Record the displayed role so the external-update re-sync below doesn't
        // redundantly re-push the same value right after init.
        lastSyncedRoleRef.current = systemRole;
      } else {
        setSourceMarkdown('');
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
    setProgrammaticDocument,
    setSourceMarkdown,
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
        setProgrammaticDocument(editor, 'json', editorData, systemRole);
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
      setProgrammaticDocument(editor, 'markdown', role, role);
    } catch {
      // ignore
    }
  }, [
    contentInit,
    editor,
    editorData,
    editorInit,
    setProgrammaticDocument,
    streamingInProgress,
    systemRole,
  ]);

  return (
    <Flexbox className={styles.root} gap={16}>
      <Flexbox gap={4}>
        <Flexbox horizontal align={'center'} distribution={'space-between'} gap={8}>
          <Flexbox horizontal align={'center'} gap={6}>
            <div className={styles.title}>{t('settingAgent.prompt.title')}</div>
            <InfoTooltip
              iconStyle={{ cursor: 'help' }}
              size={'small'}
              title={t('settingAgent.prompt.desc')}
            />
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={4}>
            {promptSaveStatus !== 'idle' && (
              <AutoSaveHint
                lastUpdatedTime={promptLastUpdatedTime}
                saveStatus={promptSaveStatus}
                onRetry={editable ? () => void retryPromptSave() : undefined}
              />
            )}
            <Flexbox
              horizontal
              gap={2}
              // The profile content wrapper focuses the prompt editor on any
              // bubbled click, and Lexical's focus() moves the caret to the
              // document end when there is no selection — scrolling the page to
              // the bottom. Toggling the view mode must not move the caret.
              onClick={(e) => e.stopPropagation()}
            >
              <ActionIcon
                active={activeEditorMode === 'visual'}
                aria-label={t('settingAgent.prompt.mode.visual')}
                aria-pressed={activeEditorMode === 'visual'}
                icon={LetterTextIcon}
                size={'small'}
                title={t('settingAgent.prompt.mode.visual')}
                onClick={() => setEditorMode('visual')}
              />
              <ActionIcon
                active={activeEditorMode === 'source'}
                aria-label={t('settingAgent.prompt.mode.source')}
                aria-pressed={activeEditorMode === 'source'}
                icon={CodeXmlIcon}
                size={'small'}
                title={t('settingAgent.prompt.mode.source')}
                onClick={() => setEditorMode('source')}
              />
            </Flexbox>
          </Flexbox>
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
        <div hidden={activeEditorMode !== 'visual'}>
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
        {activeEditorMode === 'source' && contentInit && (
          <CodeEditorPane
            className={styles.sourceEditor}
            language={'markdown'}
            readOnly={!editable || streamingInProgress}
            value={sourceMarkdown}
            onChange={handleSourceChange}
          />
        )}
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
          toast.error(t('saveAgentConfigFail', { ns: 'common' }));
        }
      });
    },
    [agentId, flushSave, storeApi, t],
  );

  if (!agentId) return null;

  return <AgentEditorCanvas agentId={agentId} key={agentId} />;
});

export default EditorCanvas;
