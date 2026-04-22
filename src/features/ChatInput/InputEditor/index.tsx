import { isDesktop } from '@lobechat/const';
import { HotkeyEnum, KeyEnum } from '@lobechat/const/hotkeys';
import { chainInputCompletion } from '@lobechat/prompts';
import { isCommandPressed, merge } from '@lobechat/utils';
import { INSERT_MENTION_COMMAND, ReactAutoCompletePlugin, ReactMathPlugin } from '@lobehub/editor';
import { Editor, FloatMenu, useEditorState } from '@lobehub/editor/react';
import { combineKeys } from '@lobehub/ui';
import { css, cx } from 'antd-style';
import Fuse from 'fuse.js';
import { KEY_ESCAPE_COMMAND } from 'lexical';
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import { useHotkeysContext } from 'react-hotkeys-hook';

import { usePasteFile, useUploadFiles } from '@/components/DragUploadZone';
import { useIMECompositionEvent } from '@/hooks/useIMECompositionEvent';
import { chatService } from '@/services/chat';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import {
  labPreferSelectors,
  preferenceSelectors,
  settingsSelectors,
  systemAgentSelectors,
} from '@/store/user/selectors';

import { useAgentId } from '../hooks/useAgentId';
import { useChatInputStore, useStoreApi } from '../store';
import {
  INSERT_ACTION_TAG_COMMAND,
  type InsertActionTagPayload,
  useSlashActionItems,
} from './ActionTag';
import { createMentionMenu } from './MentionMenu';
import type { MentionMenuState } from './MentionMenu/types';
import Placeholder, { type PlaceholderVariant } from './Placeholder';
import { CHAT_INPUT_EMBED_PLUGINS, createChatInputRichPlugins } from './plugins';
import { INSERT_REFER_TOPIC_COMMAND } from './ReferTopic';
import { useMentionCategories } from './useMentionCategories';

const className = cx(css`
  p {
    margin-block-end: 0;
  }
`);

const InputEditor = memo<{
  defaultRows?: number;
  placeholder?: ReactNode;
  placeholderVariant?: PlaceholderVariant;
}>(({ defaultRows = 2, placeholder, placeholderVariant }) => {
  const [editor, slashMenuRef, send, updateMarkdownContent, expand, slashPlacement] =
    useChatInputStore((s) => [
      s.editor,
      s.slashMenuRef,
      s.handleSendButton,
      s.updateMarkdownContent,
      s.expand,
      s.slashPlacement ?? 'top',
    ]);

  const storeApi = useStoreApi();
  const state = useEditorState(editor);
  const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.AddUserMessage));
  const { enableScope, disableScope } = useHotkeysContext();

  const { compositionProps, isComposingRef } = useIMECompositionEvent();

  const useCmdEnterToSend = useUserStore(preferenceSelectors.useCmdEnterToSend);

  // --- Category-based mention system ---
  const categories = useMentionCategories();
  const stateRef = useRef<MentionMenuState>({ isSearch: false, matchingString: '' });
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;

  const allMentionItems = useMemo(() => categories.flatMap((c) => c.items), [categories]);

  const fuse = useMemo(
    () =>
      new Fuse(allMentionItems, {
        keys: ['key', 'label', 'metadata.topicTitle'],
        threshold: 0.3,
      }),
    [allMentionItems],
  );

  const mentionItemsFn = useCallback(
    async (
      search: { leadOffset: number; matchingString: string; replaceableString: string } | null,
    ) => {
      if (search?.matchingString) {
        stateRef.current = { isSearch: true, matchingString: search.matchingString };
        return fuse.search(search.matchingString).map((r) => r.item);
      }
      stateRef.current = { isSearch: false, matchingString: '' };
      return [...allMentionItems];
    },
    [allMentionItems, fuse],
  );

  const MentionMenuComp = useMemo(() => createMentionMenu(stateRef, categoriesRef), []);

  const enableMention = allMentionItems.length > 0;

  // Get agent's model info for vision support check and handle paste upload
  const agentId = useAgentId();
  const model = useAgentStore((s) => agentByIdSelectors.getAgentModelById(agentId)(s));
  const provider = useAgentStore((s) => agentByIdSelectors.getAgentModelProviderById(agentId)(s));
  const heterogeneousType = useAgentStore(
    (s) => agentByIdSelectors.getAgencyConfigById(agentId)(s)?.heterogeneousProvider?.type,
  );
  const heterogeneousName = heterogeneousType === 'claude-code' ? 'Claude Code' : undefined;
  // Heterogeneous agents (e.g. Claude Code) don't yet support @-assigning to other agents
  const showAgentAssignmentHint =
    !heterogeneousName && categories.some((category) => category.id === 'agent');
  const { handleUploadFiles } = useUploadFiles({ model, provider });

  // Listen to editor's paste event for file uploads
  usePasteFile(editor, handleUploadFiles);

  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (!state.isEmpty) {
        // set returnValue to trigger alert modal
        // Note: No matter what value is set, the browser will display the standard text
        e.returnValue = 'You are typing something, are you sure you want to leave?';
      }
    };
    window.addEventListener('beforeunload', fn);
    return () => {
      window.removeEventListener('beforeunload', fn);
    };
  }, [state.isEmpty]);

  const enableRichRender = useUserStore(labPreferSelectors.enableInputMarkdown);

  const slashActionItems = useSlashActionItems();
  const slashItems = useCallback(
    async (
      search: { leadOffset: number; matchingString: string; replaceableString: string } | null,
    ) => {
      const actionItems =
        typeof slashActionItems === 'function' ? await slashActionItems(search) : slashActionItems;

      return actionItems;
    },
    [slashActionItems],
  );

  // --- Auto-completion ---
  const inputCompletionConfig = useUserStore(systemAgentSelectors.inputCompletion);
  const isAutoCompleteEnabled = inputCompletionConfig.enabled;

  const getMessagesRef = useRef(storeApi.getState().getMessages);
  useEffect(() => {
    return storeApi.subscribe((s) => {
      getMessagesRef.current = s.getMessages;
    });
  }, [storeApi]);

  const handleAutoComplete = useCallback(
    async ({
      abortSignal,
      afterText,
      input,
    }: {
      abortSignal: AbortSignal;
      afterText: string;
      editor: any;
      input: string;
      selectionType: string;
    }): Promise<string | null> => {
      // Skip autocomplete during IME composition (e.g. Chinese input method)
      if (isComposingRef.current) return null;

      if (!input.trim()) return null;

      // Skip when cursor is not at end of paragraph — inserting a placeholder
      // mid-text causes nested editor updates that freeze the input
      if (afterText.trim()) return null;

      const { enabled: _, ...config } = systemAgentSelectors.inputCompletion(
        useUserStore.getState(),
      );
      const context = getMessagesRef.current?.();
      const chainParams = chainInputCompletion(input, afterText, context);

      const abortController = new AbortController();
      abortSignal.addEventListener('abort', () => abortController.abort());

      let result = '';

      try {
        await chatService.fetchPresetTaskResult({
          abortController,
          onMessageHandle: (chunk) => {
            if (chunk.type === 'text') {
              result += chunk.text;
            }
          },
          params: merge(config, chainParams),
        });
      } catch {
        return null;
      }

      if (abortSignal.aborted) return null;

      return result.trimEnd() || null;
    },
    [isComposingRef],
  );

  const autoCompletePlugin = useMemo(
    () =>
      isAutoCompleteEnabled
        ? Editor.withProps(ReactAutoCompletePlugin, {
            delay: 600,
            onAutoComplete: handleAutoComplete,
          })
        : null,
    [isAutoCompleteEnabled, handleAutoComplete],
  );

  // --- Stable mentionOption & slashOption to prevent infinite re-render on paste ---
  const mentionMarkdownWriter = useCallback((mention: any) => {
    if (mention.metadata?.type === 'topic') {
      return `<refer_topic name="${mention.metadata.topicTitle}" id="${mention.metadata.topicId}" />`;
    }
    return `<mention name="${mention.label}" id="${mention.metadata.id}" />`;
  }, []);

  const mentionOnSelect = useCallback((editor: any, option: any) => {
    if (option.metadata?.type === 'topic') {
      editor.dispatchCommand(INSERT_REFER_TOPIC_COMMAND, {
        topicId: option.metadata.topicId as string,
        topicTitle: String(option.metadata.topicTitle ?? option.label),
      });
    } else if (option.metadata?.type === 'skill' || option.metadata?.type === 'tool') {
      const payload: InsertActionTagPayload = {
        category: option.metadata.actionCategory as 'skill' | 'tool',
        label: String(option.label),
        type: String(option.metadata.actionType),
      };
      editor.dispatchCommand(INSERT_ACTION_TAG_COMMAND, payload);
    } else {
      editor.dispatchCommand(INSERT_MENTION_COMMAND, {
        label: String(option.label),
        metadata: option.metadata,
      });
    }
  }, []);

  const mentionOption = useMemo(
    () =>
      enableMention
        ? {
            items: mentionItemsFn,
            markdownWriter: mentionMarkdownWriter,
            maxLength: 50,
            onSelect: mentionOnSelect,
            renderComp: MentionMenuComp,
          }
        : undefined,
    [enableMention, mentionItemsFn, mentionMarkdownWriter, mentionOnSelect, MentionMenuComp],
  );

  const slashOption = useMemo(() => ({ items: slashItems }), [slashItems]);

  const richRenderProps = useMemo(() => {
    const basePlugins = !enableRichRender
      ? CHAT_INPUT_EMBED_PLUGINS
      : createChatInputRichPlugins({
          mathPlugin: Editor.withProps(ReactMathPlugin, {
            renderComp: expand
              ? undefined
              : (props) => (
                  <FloatMenu {...props} getPopupContainer={() => (slashMenuRef as any)?.current} />
                ),
          }),
        });

    const plugins = autoCompletePlugin ? [...basePlugins, autoCompletePlugin] : basePlugins;

    return !enableRichRender
      ? { enablePasteMarkdown: false, markdownOption: false, plugins }
      : { plugins };
  }, [enableRichRender, expand, slashMenuRef, autoCompletePlugin]);

  return (
    <Editor
      autoFocus
      pasteAsPlainText
      className={className}
      content={''}
      editor={editor}
      {...{ slashPlacement }}
      {...richRenderProps}
      mentionOption={mentionOption}
      slashOption={slashOption}
      type={'text'}
      variant={'chat'}
      placeholder={
        placeholder ?? (
          <Placeholder
            heterogeneousName={heterogeneousName}
            showAgentAssignmentHint={showAgentAssignmentHint}
            variant={placeholderVariant}
          />
        )
      }
      style={{
        minHeight: defaultRows > 1 ? defaultRows * 23 : undefined,
      }}
      onCompositionEnd={({ event }) => compositionProps.onCompositionEnd(event)}
      onBlur={() => {
        disableScope(HotkeyEnum.AddUserMessage);
      }}
      onChange={() => {
        updateMarkdownContent();
      }}
      onCompositionStart={({ event }) => {
        compositionProps.onCompositionStart(event);
        // Clear autocomplete placeholder nodes before IME composition starts —
        // composing next to placeholder inline nodes freezes the editor.
        if (isAutoCompleteEnabled) {
          editor?.dispatchCommand(
            KEY_ESCAPE_COMMAND,
            new KeyboardEvent('keydown', { key: 'Escape' }),
          );
        }
      }}
      onContextMenu={async ({ event: e, editor }) => {
        if (isDesktop) {
          e.preventDefault();
          const { electronSystemService } = await import('@/services/electron/system');

          const selectionText = editor.getSelectionDocument('markdown') as unknown as string;

          await electronSystemService.showContextMenu('editor', {
            selectionText: selectionText || undefined,
          });
        }
      }}
      onFocus={() => {
        enableScope(HotkeyEnum.AddUserMessage);
      }}
      onInit={(editor) => {
        const saved = storeApi.getState()._savedEditorState;
        storeApi.setState({ _savedEditorState: undefined, editor });
        if (saved) {
          requestAnimationFrame(() => {
            editor.setDocument('json', saved);
          });
        }
      }}
      onPressEnter={({ event: e }) => {
        if (e.shiftKey || isComposingRef.current) return;
        // when user like alt + enter to add ai message
        if (e.altKey && hotkey === combineKeys([KeyEnum.Alt, KeyEnum.Enter])) return true;
        const commandKey = isCommandPressed(e);
        // In fullscreen mode, Enter inserts newline; only Cmd/Ctrl+Enter sends
        if (expand) {
          if (commandKey) {
            send();
            return true;
          }
          return;
        }
        // when user like cmd + enter to send message
        if (useCmdEnterToSend) {
          if (commandKey) {
            send();
            return true;
          }
        } else {
          if (!commandKey) {
            send();
            return true;
          }
        }
      }}
    />
  );
});

InputEditor.displayName = 'InputEditor';

export default InputEditor;
