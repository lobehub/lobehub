import { isDesktop } from '@lobechat/const';
import { HotkeyEnum, KeyEnum } from '@lobechat/types';
import { isCommandPressed } from '@lobechat/utils';
import { INSERT_MENTION_COMMAND, ReactMathPlugin } from '@lobehub/editor';
import { Editor, FloatMenu, useEditorState } from '@lobehub/editor/react';
import { combineKeys } from '@lobehub/ui';
import { css, cx } from 'antd-style';
import Fuse from 'fuse.js';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useHotkeysContext } from 'react-hotkeys-hook';

import { usePasteFile, useUploadFiles } from '@/components/DragUploadZone';
import { useIMECompositionEvent } from '@/hooks/useIMECompositionEvent';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, preferenceSelectors, settingsSelectors } from '@/store/user/selectors';

import { useAgentId } from '../hooks/useAgentId';
import { useChatInputStore, useStoreApi } from '../store';
import { useSlashActionItems } from './ActionTag';
import { createMentionMenu } from './MentionMenu';
import type { MentionMenuState } from './MentionMenu/types';
import Placeholder from './Placeholder';
import { CHAT_INPUT_EMBED_PLUGINS, createChatInputRichPlugins } from './plugins';
import { INSERT_REFER_TOPIC_COMMAND } from './ReferTopic';
import { useMentionCategories } from './useMentionCategories';

const className = cx(css`
  p {
    margin-block-end: 0;
  }
`);

const InputEditor = memo<{ defaultRows?: number }>(({ defaultRows = 2 }) => {
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

  const richRenderProps = useMemo(
    () =>
      !enableRichRender
        ? {
            enablePasteMarkdown: false,
            markdownOption: false,
            plugins: CHAT_INPUT_EMBED_PLUGINS,
          }
        : {
            plugins: createChatInputRichPlugins({
              mathPlugin: Editor.withProps(ReactMathPlugin, {
                renderComp: expand
                  ? undefined
                  : (props) => (
                      <FloatMenu
                        {...props}
                        getPopupContainer={() => (slashMenuRef as any)?.current}
                      />
                    ),
              }),
            }),
          },
    [enableRichRender, expand, slashMenuRef],
  );

  return (
    <Editor
      autoFocus
      pasteAsPlainText
      className={className}
      content={''}
      editor={editor}
      {...{ slashPlacement }}
      {...richRenderProps}
      placeholder={<Placeholder />}
      type={'text'}
      variant={'chat'}
      mentionOption={
        enableMention
          ? {
              items: mentionItemsFn,
              markdownWriter: (mention) => {
                if (mention.metadata?.type === 'topic') {
                  return `<refer_topic name="${mention.metadata.topicTitle}" id="${mention.metadata.topicId}" />`;
                }
                return `<mention name="${mention.label}" id="${mention.metadata.id}" />`;
              },
              maxLength: 50,
              onSelect: (editor, option) => {
                if (option.metadata?.type === 'topic') {
                  editor.dispatchCommand(INSERT_REFER_TOPIC_COMMAND, {
                    topicId: option.metadata.topicId as string,
                    topicTitle: String(option.metadata.topicTitle ?? option.label),
                  });
                } else {
                  editor.dispatchCommand(INSERT_MENTION_COMMAND, {
                    label: String(option.label),
                    metadata: option.metadata,
                  });
                }
              },
              renderComp: MentionMenuComp,
            }
          : undefined
      }
      slashOption={{
        items: slashItems,
      }}
      style={{
        minHeight: defaultRows > 1 ? defaultRows * 23 : undefined,
      }}
      onCompositionEnd={({ event }) => compositionProps.onCompositionEnd(event)}
      onCompositionStart={({ event }) => compositionProps.onCompositionStart(event)}
      onInit={(editor) => storeApi.setState({ editor })}
      onBlur={() => {
        disableScope(HotkeyEnum.AddUserMessage);
      }}
      onChange={() => {
        updateMarkdownContent();
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
      onPressEnter={({ event: e }) => {
        if (e.shiftKey || isComposingRef.current) return;
        // when user like alt + enter to add ai message
        if (e.altKey && hotkey === combineKeys([KeyEnum.Alt, KeyEnum.Enter])) return true;
        const commandKey = isCommandPressed(e);
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
