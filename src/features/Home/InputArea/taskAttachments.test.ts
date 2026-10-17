import type { UploadFileItem } from '@lobechat/types';
import { extractMediaFromEditorState } from '@lobehub/editor';
import type { SerializedEditorState } from 'lexical';
import { describe, expect, it } from 'vitest';

import { appendTaskAttachments } from './taskAttachments';

const files: UploadFileItem[] = [
  {
    file: new File(['pdf'], 'report.pdf', { type: 'application/pdf' }),
    fileUrl: 'https://example.com/f/pdf',
    id: 'pdf',
    status: 'success',
  },
  {
    file: new File(['image'], 'photo.png', { type: 'image/png' }),
    fileUrl: 'https://example.com/f/image',
    id: 'image',
    status: 'success',
  },
];

describe('appendTaskAttachments', () => {
  it('preserves rich text and exposes documents and images to the editor media extractor', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [{ text: 'Rich draft', type: 'text', format: 1, version: 1 }],
            type: 'paragraph',
            version: 1,
          },
        ],
        type: 'root',
        version: 1,
      },
    };
    const result = appendTaskAttachments(editorData, 'Rich draft', files) as SerializedEditorState;
    expect(result.root.children[0]).toEqual(editorData.root.children[0]);
    expect(editorData.root.children).toHaveLength(1);
    const { fileList, imageList } = extractMediaFromEditorState(result);
    expect(fileList.map((item) => item.url)).toEqual(['https://example.com/f/pdf']);
    expect(imageList.map((item) => item.url)).toEqual(['https://example.com/f/image']);
  });

  it('preserves text when no editor state is available', () => {
    const result = appendTaskAttachments(undefined, 'Draft text', files) as SerializedEditorState;
    expect(result.root.children[0]).toMatchObject({ children: [{ text: 'Draft text' }] });
  });
});
