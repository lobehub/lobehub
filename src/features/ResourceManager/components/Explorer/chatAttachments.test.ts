import { describe, expect, it } from 'vitest';

import { buildChatAttachments, isChatAttachableResource } from './chatAttachments';

const file = (overrides: Record<string, unknown> = {}) => ({
  fileId: 'file-1',
  fileType: 'text/markdown',
  id: 'file-1',
  name: 'report.md',
  size: 96,
  sourceType: 'file' as const,
  url: 'https://s3.local/report.md',
  ...overrides,
});

describe('isChatAttachableResource', () => {
  it('accepts uploaded files', () => {
    expect(isChatAttachableResource(file())).toBe(true);
    expect(isChatAttachableResource(file({ fileType: 'image/png', name: 'sketch.png' }))).toBe(
      true,
    );
  });

  it('rejects folders and pages, including pages listed through a placeholder file row', () => {
    expect(isChatAttachableResource(file({ fileType: 'custom/folder', name: 'Archive' }))).toBe(
      false,
    );
    expect(
      isChatAttachableResource(
        file({ fileId: null, fileType: 'custom/document', sourceType: 'document' }),
      ),
    ).toBe(false);
    // A library page is backed by a `custom/document` placeholder in `files`.
    expect(
      isChatAttachableResource(
        file({ fileType: 'custom/document', name: 'Meeting notes', url: 'internal://document' }),
      ),
    ).toBe(false);
  });

  it('keeps PDF and Office uploads as files even when typed as a document', () => {
    expect(
      isChatAttachableResource(file({ fileType: 'custom/document', name: 'Contract.pdf' })),
    ).toBe(true);
    expect(isChatAttachableResource(file({ fileType: 'custom/document', name: 'Plan.docx' }))).toBe(
      true,
    );
  });

  it('rejects a page without a backing file even when its name looks like a PDF', () => {
    expect(
      isChatAttachableResource(file({ fileId: null, name: 'Notes.pdf', sourceType: 'document' })),
    ).toBe(false);
  });
});

describe('buildChatAttachments', () => {
  it('turns files into finished attachments that never delete the library file', () => {
    const { files, skipped, alreadyAdded } = buildChatAttachments([file()]);

    expect(skipped).toBe(0);
    expect(alreadyAdded).toBe(0);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      fileUrl: 'https://s3.local/report.md',
      id: 'file-1',
      previewUrl: 'https://s3.local/report.md',
      skipRemoveFile: true,
      status: 'success',
    });
    expect(files[0].file).toMatchObject({ name: 'report.md', size: 96, type: 'text/markdown' });
  });

  it('attaches the underlying file of a row listed under its page id', () => {
    const { files } = buildChatAttachments([file({ fileId: 'file-9', id: 'docs-9' })]);

    expect(files.map((item) => item.id)).toEqual(['file-9']);
  });

  it('counts skipped pages and folders and files the input already holds', () => {
    const result = buildChatAttachments(
      [
        file({ fileId: 'file-1', id: 'file-1' }),
        file({ fileId: 'file-2', id: 'file-2', name: 'staged.csv' }),
        file({ fileType: 'custom/folder', id: 'folder-1', name: 'Archive' }),
        file({ fileId: null, fileType: 'custom/document', id: 'page-1', sourceType: 'document' }),
        // The same file reached twice (e.g. a list row and a search hit).
        file({ fileId: 'file-1', id: 'file-1' }),
      ],
      ['file-2'],
    );

    expect(result.files.map((item) => item.id)).toEqual(['file-1']);
    expect(result.alreadyAdded).toBe(1);
    expect(result.skipped).toBe(2);
  });
});
