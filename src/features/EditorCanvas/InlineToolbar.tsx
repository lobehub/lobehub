'use client';

import { type IEditor } from '@lobehub/editor';
import { getHotkeyById, HotkeyEnum, INSERT_HEADING_COMMAND } from '@lobehub/editor';
import { type ChatInputActionsProps, type EditorState } from '@lobehub/editor/react';
import { ChatInputActions, FloatActions } from '@lobehub/editor/react';
import { Block } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import {
  BoldIcon,
  CodeXmlIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  MessageSquareQuote,
  Redo2Icon,
  SigmaIcon,
  SquareDashedBottomCodeIcon,
  StrikethroughIcon,
  UnderlineIcon,
  Undo2Icon,
} from 'lucide-react';
import { type CSSProperties } from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export interface InlineToolbarProps {
  className?: string;
  editor?: IEditor;
  editorState?: EditorState;
  /**
   * Extra items to prepend to the toolbar (e.g., "Ask Copilot" button)
   */
  extraItems?: ChatInputActionsProps['items'];
  floating?: boolean;
  style?: CSSProperties;
}

const InlineToolbar = memo<InlineToolbarProps>(
  ({ floating, style, className, editor, editorState, extraItems }) => {
    const { t } = useTranslation('editor');

    const items: ChatInputActionsProps['items'] = useMemo(() => {
      if (!editorState) return [];

      const baseItems = [
        // Extra items (like "Ask Copilot") come first
        ...(extraItems || []),
        extraItems?.length ? { type: 'divider' as const } : null,
        !floating && {
          disabled: !editorState.canUndo,
          icon: Undo2Icon,
          key: 'undo',
          label: t('typobar.undo', 'Undo'),
          onClick: editorState.undo,
          tooltipProps: { hotkey: getHotkeyById(HotkeyEnum.Undo).keys },
        },
        !floating && {
          disabled: !editorState.canRedo,
          icon: Redo2Icon,
          key: 'redo',
          label: t('typobar.redo', 'Redo'),
          onClick: editorState.redo,
          tooltipProps: { hotkey: getHotkeyById(HotkeyEnum.Redo).keys },
        },
        !floating && {
          type: 'divider',
        },
        {
          active: editorState.isBold,
          icon: BoldIcon,
          key: 'bold',
          label: t('typobar.bold'),
          onClick: editorState.bold,
          tooltipProps: { hotkey: getHotkeyById(HotkeyEnum.Bold).keys },
        },
        {
          active: editorState.isItalic,
          icon: ItalicIcon,
          key: 'italic',
          label: t('typobar.italic'),
          onClick: editorState.italic,
          tooltipProps: { hotkey: getHotkeyById(HotkeyEnum.Italic).keys },
        },
        {
          active: editorState.isUnderline,
          icon: UnderlineIcon,
          key: 'underline',
          label: t('typobar.underline'),
          onClick: editorState.underline,
          tooltipProps: { hotkey: getHotkeyById(HotkeyEnum.Underline).keys },
        },
        {
          active: editorState.isStrikethrough,
          icon: StrikethroughIcon,
          key: 'strikethrough',
          label: t('typobar.strikethrough'),
          onClick: editorState.strikethrough,
          tooltipProps: { hotkey: getHotkeyById(HotkeyEnum.Strikethrough).keys },
        },
        {
          type: 'divider',
        },
        !floating && {
          icon: Heading1Icon,
          key: 'h1',
          label: t('slash.h1'),
          onClick: () => {
            if (editor) {
              editor.dispatchCommand(INSERT_HEADING_COMMAND, { tag: 'h1' });
            }
          },
        },
        !floating && {
          icon: Heading2Icon,
          key: 'h2',
          label: t('slash.h2'),
          onClick: () => {
            if (editor) {
              editor.dispatchCommand(INSERT_HEADING_COMMAND, { tag: 'h2' });
            }
          },
        },
        !floating && {
          icon: Heading3Icon,
          key: 'h3',
          label: t('slash.h3'),
          onClick: () => {
            if (editor) {
              editor.dispatchCommand(INSERT_HEADING_COMMAND, { tag: 'h3' });
            }
          },
        },
        !floating && {
          type: 'divider',
        },
        {
          icon: ListIcon,
          key: 'bulletList',
          label: t('typobar.bulletList'),
          onClick: editorState.bulletList,
          tooltipProps: { hotkey: getHotkeyById(HotkeyEnum.BulletList).keys },
        },
        {
          icon: ListOrderedIcon,
          key: 'numberlist',
          label: t('typobar.numberList'),
          onClick: editorState.numberList,
          tooltipProps: { hotkey: getHotkeyById(HotkeyEnum.NumberList).keys },
        },
        {
          icon: ListTodoIcon,
          key: 'tasklist',
          label: t('typobar.taskList'),
          onClick: editorState.checkList,
        },
        {
          type: 'divider',
        },
        {
          active: editorState.isBlockquote,
          icon: MessageSquareQuote,
          key: 'blockquote',
          label: t('typobar.blockquote'),
          onClick: editorState.blockquote,
        },
        {
          icon: LinkIcon,
          key: 'link',
          label: t('typobar.link'),
          onClick: editorState.insertLink,
          tooltipProps: { hotkey: getHotkeyById(HotkeyEnum.Link).keys },
        },
        {
          icon: SigmaIcon,
          key: 'math',
          label: t('typobar.tex'),
          onClick: editorState.insertMath,
        },
        {
          type: 'divider',
        },
        {
          active: editorState.isCode,
          icon: CodeXmlIcon,
          key: 'code',
          label: t('typobar.code'),
          onClick: editorState.code,
          tooltipProps: { hotkey: getHotkeyById(HotkeyEnum.CodeInline).keys },
        },
        !floating && {
          icon: SquareDashedBottomCodeIcon,
          key: 'codeblock',
          label: t('typobar.codeblock'),
          onClick: editorState.codeblock,
        },
      ];

      return baseItems.filter(Boolean) as ChatInputActionsProps['items'];
    }, [editor, editorState, extraItems, floating, t]);

    if (!editorState) return null;

    // Floating toolbar - just return the actions
    if (floating) return <FloatActions className={className} items={items} style={style} />;

    // Fixed toolbar - wrap in a styled container
    return (
      <Block
        shadow
        className={className}
        padding={4}
        variant={'outlined'}
        style={{
          background: cssVar.colorBgElevated,
          borderRadius: 8,
          marginBottom: 16,
          marginTop: 16,
          position: 'sticky',
          top: 12,
          zIndex: 10,
          ...style,
        }}
      >
        <ChatInputActions items={items} />
      </Block>
    );
  },
);

InlineToolbar.displayName = 'InlineToolbar';

export default InlineToolbar;
