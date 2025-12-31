'use client';

import {
  ReactCodePlugin,
  ReactCodemirrorPlugin,
  ReactHRPlugin,
  ReactLinkHighlightPlugin,
  ReactListPlugin,
  ReactMathPlugin,
  ReactMentionPlugin,
  ReactTablePlugin,
  ReactToolbarPlugin,
} from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import { useMentionOptions } from '../ProfileEditor/MentionList';
import { EMPTY_EDITOR_STATE } from '../constants';
import { useProfileStore } from '../store';
import TypoBar from './TypoBar';
import { useSlashItems } from './useSlashItems';

const EditorCanvas = memo(() => {
  const { t } = useTranslation('setting');
  const [editorInit, setEditorInit] = useState(false);
  const [contentInit, setContentInit] = useState(false);

  // Get systemPrompt from agentGroup store (groupMap.config.systemPrompt)
  const groupConfig = useAgentGroupStore(agentGroupSelectors.currentGroupConfig, isEqual);
  const systemRole = groupConfig?.systemPrompt;
  const updateGroupConfig = useAgentGroupStore((s) => s.updateGroupConfig);

  // Get streaming state from agentGroup store
  const streamingInProgress = useAgentGroupStore((s) => s.streamingSystemPromptInProgress);
  const streamingSystemRole = useAgentGroupStore((s) => s.streamingSystemPrompt);

  // For group profile, we don't use editorData - just systemPrompt
  const editorData = undefined;
  const [initialLoad] = useState(EMPTY_EDITOR_STATE);
  const mentionOptions = useMentionOptions();
  const editor = useProfileStore((s) => s.editor);
  const handleContentChange = useProfileStore((s) => s.handleContentChange);
  const slashItems = useSlashItems();

  const prevStreamingRef = useRef<string | undefined>(undefined);

  // Wrap handleContentChange with updateGroupConfig
  const handleChange = useCallback(() => {
    // Don't trigger save during streaming
    if (streamingInProgress) return;
    handleContentChange(async (config) => {
      // Only update systemPrompt in group config
      if (config.systemRole !== undefined) {
        await updateGroupConfig({ systemPrompt: config.systemRole });
      }
    });
  }, [handleContentChange, updateGroupConfig, streamingInProgress]);

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

  useEffect(() => {
    if (!editorInit || !editor || contentInit) return;
    // Don't init if streaming is in progress
    if (streamingInProgress) return;
    try {
      if (editorData) {
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
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <Editor
        content={initialLoad}
        editor={editor!}
        lineEmptyPlaceholder={t('settingAgent.prompt.placeholder')}
        mentionOption={mentionOptions}
        onInit={() => setEditorInit(true)}
        onTextChange={handleChange}
        placeholder={t('settingAgent.prompt.templatePlaceholder')}
        plugins={[
          ReactListPlugin,
          ReactCodePlugin,
          ReactCodemirrorPlugin,
          ReactHRPlugin,
          ReactLinkHighlightPlugin,
          ReactTablePlugin,
          ReactMathPlugin,
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
      />
    </div>
  );
});

export default EditorCanvas;
