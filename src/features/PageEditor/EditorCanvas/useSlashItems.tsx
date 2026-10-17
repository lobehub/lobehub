import { type SlashOptions } from '@lobehub/editor';
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_CODEMIRROR_COMMAND,
  INSERT_HEADING_COMMAND,
  INSERT_HORIZONTAL_RULE_COMMAND,
  INSERT_IMAGE_COMMAND,
  INSERT_MATH_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_TABLE_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from '@lobehub/editor';
import { Text } from '@lobehub/ui';
import {
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  MinusIcon,
  SigmaIcon,
  SquareDashedBottomCodeIcon,
  Table2Icon,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { openFileSelector } from '@/features/EditorCanvas';

export const useSlashItems = (): SlashOptions['items'] => {
  const { t } = useTranslation('editor');

  return useMemo(() => {
    const data: SlashOptions['items'] = [
      {
        icon: Heading1Icon,
        key: 'h1',
        label: t('slash.h1'),
        onSelect: (editor) => {
          editor.dispatchCommand(INSERT_HEADING_COMMAND, { tag: 'h1' });
        },
      },
      {
        icon: Heading2Icon,
        key: 'h2',
        label: t('slash.h2'),
        onSelect: (editor) => {
          editor.dispatchCommand(INSERT_HEADING_COMMAND, { tag: 'h2' });
        },
      },
      {
        icon: Heading3Icon,
        key: 'h3',
        label: t('slash.h3'),
        onSelect: (editor) => {
          editor.dispatchCommand(INSERT_HEADING_COMMAND, { tag: 'h3' });
        },
      },
      {
        type: 'divider',
      },
      {
        icon: ListTodoIcon,
        key: 'tl',
        label: t('typobar.taskList'),
        onSelect: (editor) => {
          editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
        },
      },
      {
        icon: ListIcon,
        key: 'ul',
        label: t('typobar.bulletList'),
        onSelect: (editor) => {
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
        },
      },
      {
        icon: ListOrderedIcon,
        key: 'ol',
        label: t('typobar.numberList'),
        onSelect: (editor) => {
          editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
        },
      },
      {
        type: 'divider',
      },
      {
        icon: ImageIcon,
        key: 'image',
        label: t('typobar.image'),
        onSelect: (editor) => {
          openFileSelector((files) => {
            for (const file of files) {
              if (file && file.type.startsWith('image/')) {
                editor.dispatchCommand(INSERT_IMAGE_COMMAND, { file });
              }
            }
          }, 'image/*');
        },
      },
      {
        icon: MinusIcon,
        key: 'hr',
        label: t('slash.hr'),
        onSelect: (editor) => {
          editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, {});
        },
      },
      {
        icon: Table2Icon,
        key: 'table',
        label: t('slash.table'),
        onSelect: (editor) => {
          editor.dispatchCommand(INSERT_TABLE_COMMAND, { columns: '3', rows: '3' });
        },
      },
      {
        icon: SquareDashedBottomCodeIcon,
        key: 'codeblock',
        label: t('typobar.codeblock'),
        onSelect: (editor) => {
          editor.dispatchCommand(INSERT_CODEMIRROR_COMMAND, undefined);
          queueMicrotask(() => {
            editor.focus();
          });
        },
      },
      {
        icon: SigmaIcon,
        key: 'tex',
        label: t('slash.tex'),
        onSelect: (editor) => {
          editor.dispatchCommand(INSERT_MATH_COMMAND, { code: 'x^2 + y^2 = z^2' });
          queueMicrotask(() => {
            editor.focus();
          });
        },
      },
    ];
    return data.map((item) => {
      if (item.type === 'divider') return item;
      return {
        ...item,
        extra: (
          <Text code fontSize={12} type={'secondary'}>
            {item.key}
          </Text>
        ),
        style: {
          minWidth: 200,
        },
      };
    });
  }, [t]);
};
