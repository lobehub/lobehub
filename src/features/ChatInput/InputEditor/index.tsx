import { isDesktop } from '@lobechat/const';
import { HotkeyEnum, KeyEnum } from '@lobechat/types';
import { isCommandPressed } from '@lobechat/utils';
import {
  INSERT_MENTION_COMMAND,
  INSERT_TABLE_COMMAND,
  ReactCodePlugin,
  ReactCodeblockPlugin,
  ReactHRPlugin,
  ReactLinkHighlightPlugin,
  ReactListPlugin,
  ReactMathPlugin,
  ReactTablePlugin,
} from '@lobehub/editor';
import { Editor, FloatMenu, SlashMenu, useEditorState } from '@lobehub/editor/react';
import { combineKeys } from '@lobehub/ui';
import { css, cx } from 'antd-style';
import { Table2Icon } from 'lucide-react';
import { memo, useEffect, useMemo, useRef } from 'react';
import { useHotkeysContext } from 'react-hotkeys-hook';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { preferenceSelectors, settingsSelectors } from '@/store/user/selectors';

import { useChatInputStore, useStoreApi } from '../store';
import Placeholder from './Placeholder';

const className = cx(css`
  p {
    margin-block-end: 0;
  }
`);

const InputEditor = memo<{ defaultRows?: number }>(({ defaultRows = 2 }) => {
  const [editor, slashMenuRef, send, updateMarkdownContent, expand, mentionItems] =
    useChatInputStore((s) => [
      s.editor,
      s.slashMenuRef,
      s.handleSendButton,
      s.updateMarkdownContent,
      s.expand,
      s.mentionItems,
    ]);

  const storeApi = useStoreApi();
  const state = useEditorState(editor);
  const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.AddUserMessage));
  const { enableScope, disableScope } = useHotkeysContext();
  const { t } = useTranslation(['editor', 'chat']);

  const isChineseInput = useRef(false);

  const useCmdEnterToSend = useUserStore(preferenceSelectors.useCmdEnterToSend);

  const enableMention = !!mentionItems && mentionItems.length > 0;

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

  const enableRichRender = useUserStore(preferenceSelectors.inputMarkdownRender);

  const richRenderProps = useMemo(
    () =>
      !enableRichRender
        ? {
            enablePasteMarkdown: false,
            markdownOption: {
              bold: false,
              code: false,
              header: false,
              italic: false,
              quote: false,
              strikethrough: false,
              underline: false,
              underlineStrikethrough: false,
            },
          }
        : {
            plugins: [
              ReactListPlugin,
              ReactCodePlugin,
              ReactCodeblockPlugin,
              ReactHRPlugin,
              ReactLinkHighlightPlugin,
              ReactTablePlugin,
              Editor.withProps(ReactMathPlugin, {
                renderComp: expand
                  ? undefined
                  : (props) => (
                      <FloatMenu
                        {...props}
                        getPopupContainer={() => (slashMenuRef as any)?.current}
                      />
                    ),
              }),
            ],
          },
    [enableRichRender],
  );

  return (
    <Editor
      autoFocus
      className={className}
      content={''}
      editor={editor}
      {...richRenderProps}
      mentionOption={
        enableMention
          ? {
              items: mentionItems,
              markdownWriter: (mention) => {
                return `<mention name="${mention.label}" id="${mention.metadata.id}" />`;
              },
              onSelect: (editor, option) => {
                editor.dispatchCommand(INSERT_MENTION_COMMAND, {
                  label: String(option.label),
                  metadata: option.metadata,
                });
              },
              renderComp: expand
                ? undefined
                : (props) => {
                    return (
                      <SlashMenu
                        {...props}
                        getPopupContainer={() => (slashMenuRef as any)?.current}
                      />
                    );
                  },
            }
          : undefined
      }
      onBlur={() => {
        disableScope(HotkeyEnum.AddUserMessage);
      }}
      onChange={() => {
        updateMarkdownContent();
      }}
      onCompositionEnd={() => {
        isChineseInput.current = false;
      }}
      onCompositionStart={() => {
        isChineseInput.current = true;
      }}
      onContextMenu={async ({ event: e, editor }) => {
        if (isDesktop) {
          e.preventDefault();
          const { electronSystemService } = await import('@/services/electron/system');

          const selectionValue = editor.getSelectionDocument('markdown') as unknown as string;
          const hasSelection = !!selectionValue;

          await electronSystemService.showContextMenu('editor', {
            hasSelection,
            value: selectionValue,
          });
        }
      }}
      onFocus={() => {
        enableScope(HotkeyEnum.AddUserMessage);
      }}
      onInit={(editor) => storeApi.setState({ editor })}
      onPressEnter={({ event: e }) => {
        if (e.shiftKey || isChineseInput.current) return;
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
      placeholder={<Placeholder />}
      slashOption={{
        items: [
          {
            icon: Table2Icon,
            key: 'table',
            label: t('typobar.table'),
            onSelect: (editor) => {
              editor.dispatchCommand(INSERT_TABLE_COMMAND, { columns: '3', rows: '3' });
            },
          },
        ],
        renderComp: expand
          ? undefined
          : (props) => {
              return (
                <SlashMenu {...props} getPopupContainer={() => (slashMenuRef as any)?.current} />
              );
            },
      }}
      style={{
        minHeight: defaultRows > 1 ? defaultRows * 23 : undefined,
      }}
      type={'text'}
      variant={'chat'}
    />
  );
});

InputEditor.displayName = 'InputEditor';

export default InputEditor;
