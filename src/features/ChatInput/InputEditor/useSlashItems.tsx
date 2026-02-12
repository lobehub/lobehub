import { type SlashOptions } from '@lobehub/editor';
import {
  INSERT_HEADING_COMMAND,
  INSERT_HORIZONTAL_RULE_COMMAND,
  INSERT_MATH_COMMAND,
  INSERT_TABLE_COMMAND,
} from '@lobehub/editor';
import { Text } from '@lobehub/ui';
import {
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  MinusIcon,
  SigmaIcon,
  Table2Icon,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

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
      };
    });
  }, [t]);
};
