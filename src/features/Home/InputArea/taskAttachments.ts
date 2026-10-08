import type { UploadFileItem } from '@lobechat/types';
import { toRecord } from '@lobechat/utils/object';

/** Persist Home's external upload tray using the task editor's attachment format. */
export const appendTaskAttachments = (
  editorData: unknown,
  message: string,
  files: UploadFileItem[],
): unknown => {
  if (files.length === 0) return editorData;

  const data = toRecord(editorData) ?? {};
  const root = toRecord(data.root) ?? {};
  const children = Array.isArray(root.children)
    ? root.children
    : message
      ? [
          {
            children: [
              {
                detail: 0,
                format: 0,
                mode: 'normal',
                style: '',
                text: message,
                type: 'text',
                version: 1,
              },
            ],
            direction: null,
            format: '',
            indent: 0,
            type: 'paragraph',
            version: 1,
          },
        ]
      : [];

  return {
    ...data,
    root: {
      direction: null,
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
      ...root,
      children: [
        ...children,
        ...files.map(({ file, fileUrl, dimensions }) =>
          file.type.startsWith('image/')
            ? {
                altText: file.name,
                height: dimensions?.height ?? 0,
                maxWidth: 800,
                src: fileUrl,
                status: 'uploaded',
                type: 'block-image',
                version: 1,
                width: dimensions?.width ?? 0,
              }
            : {
                children: [
                  {
                    fileUrl,
                    name: file.name,
                    size: file.size,
                    status: 'uploaded',
                    type: 'file',
                    version: 1,
                  },
                ],
                direction: null,
                format: '',
                indent: 0,
                type: 'paragraph',
                version: 1,
              },
        ),
      ],
    },
  };
};
