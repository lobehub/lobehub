import { type IEditor, type SlashOptions } from '@lobehub/editor';
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
import { useFileStore } from '@/store/file';

export const useSlashItems = (editor: IEditor | undefined): SlashOptions['items'] => {
  const { t } = useTranslation('editor');

  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);

  const handleImageUpload = async (file: File) => {
    if (!editor) return;

    try {
      // Create a blob URL for immediate preview
      const blobUrl = URL.createObjectURL(file);

      // Insert the image immediately with blob URL for preview
      editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
        file,
      });

      // Upload the image to storage in background
      const result = await uploadWithProgress({
        file,
        skipCheckFileType: false,
        source: 'page-editor',
      });

      if (result) {
        // Replace the blob URL with permanent URL in the editor state
        const currentDoc = editor.getDocument('json');
        if (currentDoc) {
          // Recursively search and replace blob URL with permanent URL
          const replaceBlobUrl = (obj: any): any => {
            if (typeof obj === 'string' && obj.startsWith('blob:')) {
              // Replace any blob URL with our permanent URL
              return result.url;
            }
            if (obj && typeof obj === 'object') {
              const newObj: any = Array.isArray(obj) ? [] : {};
              const entries = Object.entries(obj);
              for (const [key, value] of entries) {
                newObj[key] = replaceBlobUrl(value);
              }
              return newObj;
            }
            return obj;
          };

          const updatedDoc = replaceBlobUrl(currentDoc);
          editor.setDocument('json', JSON.stringify(updatedDoc));
        }

        // Clean up the blob URL
        URL.revokeObjectURL(blobUrl);
        console.log('Image uploaded and URL updated:', result.url);
      }
    } catch (error) {
      console.error('Failed to upload image:', error);
    }
  };

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
        onSelect: () => {
          openFileSelector((files) => {
            for (const file of files) {
              if (file && file.type.startsWith('image/')) {
                void handleImageUpload(file);
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
