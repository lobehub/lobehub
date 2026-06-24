import { type IEditor } from '@lobehub/editor';
import { getHotkeyById, HotkeyEnum } from '@lobehub/editor';
import { type ChatInputActionsProps } from '@lobehub/editor/react';
import { ChatInputActionBar, ChatInputActions, useEditorState } from '@lobehub/editor/react';
import { cssVar } from 'antd-style';
import {
  BoldIcon,
  CodeXmlIcon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  MessageSquareQuote,
  SigmaIcon,
  SquareDashedBottomCodeIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

interface TypoBarProps {
  editor?: IEditor;
  popupContainer?: HTMLElement | null;
}

const TypoBar = memo<TypoBarProps>(({ editor, popupContainer }) => {
  const { t } = useTranslation('editor');
  const editorState = useEditorState(editor);

  const baseTooltipProps = useMemo(
    () => (popupContainer ? { popupContainer } : undefined),
    [popupContainer],
  );

  const createTooltipProps = useCallback(
    (hotkey?: string[]) => ({
      ...baseTooltipProps,
      ...(hotkey ? { hotkey } : {}),
    }),
    [baseTooltipProps],
  );

  const items: ChatInputActionsProps['items'] = useMemo(
    () =>
      [
        {
          active: editorState.isBold,
          icon: BoldIcon,
          key: 'bold',
          label: t('typobar.bold'),
          onClick: editorState.bold,
          tooltipProps: createTooltipProps(getHotkeyById(HotkeyEnum.Bold).keys),
        },
        {
          active: editorState.isItalic,
          icon: ItalicIcon,
          key: 'italic',
          label: t('typobar.italic'),
          onClick: editorState.italic,
          tooltipProps: createTooltipProps(getHotkeyById(HotkeyEnum.Italic).keys),
        },
        {
          active: editorState.isUnderline,
          icon: UnderlineIcon,
          key: 'underline',
          label: t('typobar.underline'),
          onClick: editorState.underline,
          tooltipProps: createTooltipProps(getHotkeyById(HotkeyEnum.Underline).keys),
        },
        {
          active: editorState.isStrikethrough,
          icon: StrikethroughIcon,
          key: 'strikethrough',
          label: t('typobar.strikethrough'),
          onClick: editorState.strikethrough,
          tooltipProps: createTooltipProps(getHotkeyById(HotkeyEnum.Strikethrough).keys),
        },
        {
          type: 'divider',
        },

        {
          icon: ListIcon,
          key: 'bulletList',
          label: t('typobar.bulletList'),
          onClick: editorState.bulletList,
          tooltipProps: createTooltipProps(getHotkeyById(HotkeyEnum.BulletList).keys),
        },
        {
          icon: ListOrderedIcon,
          key: 'numberlist',
          label: t('typobar.numberList'),
          onClick: editorState.numberList,
          tooltipProps: createTooltipProps(getHotkeyById(HotkeyEnum.NumberList).keys),
        },
        {
          icon: ListTodoIcon,
          key: 'tasklist',
          label: t('typobar.taskList'),
          onClick: editorState.checkList,
          tooltipProps: baseTooltipProps,
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
          tooltipProps: baseTooltipProps,
        },
        {
          type: 'divider',
        },
        {
          icon: SigmaIcon,
          key: 'math',
          label: t('typobar.tex'),
          onClick: editorState.insertMath,
          tooltipProps: baseTooltipProps,
        },
        {
          active: editorState.isCode,
          icon: CodeXmlIcon,
          key: 'code',
          label: t('typobar.code'),
          onClick: editorState.code,
          tooltipProps: createTooltipProps(getHotkeyById(HotkeyEnum.CodeInline).keys),
        },
        {
          icon: SquareDashedBottomCodeIcon,
          key: 'codeblock',
          label: t('typobar.codeblock'),
          onClick: editorState.codeblock,
          tooltipProps: baseTooltipProps,
        },
      ].filter(Boolean) as ChatInputActionsProps['items'],
    [baseTooltipProps, createTooltipProps, editorState, t],
  );

  return (
    <ChatInputActionBar
      left={<ChatInputActions items={items} />}
      style={{
        background: cssVar.colorFillQuaternary,
        borderTopLeftRadius: 8,
        borderTopRightRadius: 8,
      }}
    />
  );
});

TypoBar.displayName = 'TypoBar';

export default TypoBar;
