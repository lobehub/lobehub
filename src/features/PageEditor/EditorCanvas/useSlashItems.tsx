import { type SlashOptions } from '@lobehub/editor';
import {
  INSERT_ARTIFACT_COMMAND,
  INSERT_CHECK_LIST_COMMAND,
  INSERT_CODEMIRROR_COMMAND,
  INSERT_COLLAPSIBLE_COMMAND,
  INSERT_HEADING_COMMAND,
  INSERT_HORIZONTAL_RULE_COMMAND,
  INSERT_IMAGE_COMMAND,
  INSERT_MATH_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_TABLE_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from '@lobehub/editor';
import {
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ListCollapseIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  MinusIcon,
  PanelsTopLeftIcon,
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
        items: [
          {
            icon: Heading1Icon,
            key: 'h1',
            label: t('slash.h1'),
            layout: 'tile',
            shortcut: 'H1',
            onSelect: (editor) => {
              editor.dispatchCommand(INSERT_HEADING_COMMAND, { tag: 'h1' });
            },
          },
          {
            icon: Heading2Icon,
            key: 'h2',
            label: t('slash.h2'),
            layout: 'tile',
            shortcut: 'H2',
            onSelect: (editor) => {
              editor.dispatchCommand(INSERT_HEADING_COMMAND, { tag: 'h2' });
            },
          },
          {
            icon: Heading3Icon,
            key: 'h3',
            label: t('slash.h3'),
            layout: 'tile',
            shortcut: 'H3',
            onSelect: (editor) => {
              editor.dispatchCommand(INSERT_HEADING_COMMAND, { tag: 'h3' });
            },
          },
        ],
        key: 'headings',
        label: t('slash.section.headings'),
        type: 'section',
      },
      {
        items: [
          {
            icon: ListTodoIcon,
            key: 'tl',
            label: t('typobar.taskList'),
            layout: 'tile',
            shortcut: '[]',
            onSelect: (editor) => {
              editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
            },
          },
          {
            icon: ListIcon,
            key: 'ul',
            label: t('typobar.bulletList'),
            layout: 'tile',
            shortcut: '-',
            onSelect: (editor) => {
              editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
            },
          },
          {
            icon: ListOrderedIcon,
            key: 'ol',
            label: t('typobar.numberList'),
            layout: 'tile',
            shortcut: '1.',
            onSelect: (editor) => {
              editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
            },
          },
        ],
        key: 'lists',
        label: t('slash.section.lists'),
        type: 'section',
      },
      {
        items: [
          {
            icon: ImageIcon,
            key: 'image',
            label: t('typobar.image'),
            layout: 'tile',
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
            layout: 'tile',
            onSelect: (editor) => {
              editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, {});
            },
          },
          {
            icon: Table2Icon,
            key: 'table',
            label: t('slash.table'),
            layout: 'tile',
            onSelect: (editor) => {
              editor.dispatchCommand(INSERT_TABLE_COMMAND, { columns: '3', rows: '3' });
            },
          },
          {
            icon: SquareDashedBottomCodeIcon,
            key: 'codeblock',
            label: t('typobar.codeblock'),
            layout: 'tile',
            onSelect: (editor) => {
              editor.dispatchCommand(INSERT_CODEMIRROR_COMMAND, undefined);
              queueMicrotask(() => {
                editor.focus();
              });
            },
          },
          {
            icon: PanelsTopLeftIcon,
            key: 'artifact',
            label: 'Artifact',
            layout: 'tile',
            onSelect: (editor) => {
              editor.dispatchCommand(INSERT_ARTIFACT_COMMAND, {
                html: `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      body { font-family: system-ui; padding: 32px; }
      .card { padding: 24px; border: 1px solid #ddd; border-radius: 16px; }
    </style>
  </head>
  <body>
    <div class="card"><h1>Hello Artifact</h1><p>在左侧编辑 HTML。</p></div>
  </body>
</html>`,
                title: 'HTML Artifact',
              });
            },
          },
          {
            icon: SigmaIcon,
            key: 'tex',
            label: t('slash.tex'),
            layout: 'tile',
            onSelect: (editor) => {
              editor.dispatchCommand(INSERT_MATH_COMMAND, { code: 'x^2 + y^2 = z^2' });
              queueMicrotask(() => {
                editor.focus();
              });
            },
          },
          {
            icon: ListCollapseIcon,
            key: 'collapsible',
            label: t('slash.collapsible'),
            layout: 'tile',
            onSelect: (editor) => {
              editor.dispatchCommand(INSERT_COLLAPSIBLE_COMMAND, {});
              queueMicrotask(() => {
                editor.focus();
              });
            },
          },
        ],
        key: 'insert',
        label: t('slash.section.insert'),
        type: 'section',
      },
    ];
    return data;
  }, [t]);
};
