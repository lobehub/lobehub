import { beforeEach, describe, expect, it, vi } from 'vitest';

import { collectMarkdownImageUrls, resolveInlineImages } from './inlineImages';

const mocks = vi.hoisted(() => ({
  resolveAttachmentMetadata: vi.fn(),
  resolveFileIdsFromUrls: vi.fn(),
}));

vi.mock('./extractFileIdsFromEditorData', () => ({
  resolveFileIdsFromUrls: mocks.resolveFileIdsFromUrls,
}));
vi.mock('./resolveAttachments', () => ({
  resolveAttachmentMetadata: mocks.resolveAttachmentMetadata,
}));

const ctx = { db: {} as any, userId: 'user-1', workspaceId: 'ws-1' };
const pasted =
  '![image.png](https://app.lobehub.com/f/file_VbV3vFGeXLTN)\n\n环境变量加了，然后 CI 这个好像挂了';

describe('collectMarkdownImageUrls', () => {
  it('collects the URL of every markdown image, in order', () => {
    expect(
      collectMarkdownImageUrls(
        `${pasted}\n![](/f/file_2) and ![b](<https://cdn.example.com/b.png> "title")`,
      ),
    ).toEqual([
      'https://app.lobehub.com/f/file_VbV3vFGeXLTN',
      '/f/file_2',
      'https://cdn.example.com/b.png',
    ]);
  });

  it('ignores image syntax inside code or escaped', () => {
    expect(
      collectMarkdownImageUrls(
        'inline `![a](/f/file_1)`, escaped \\![b](/f/file_2)\n\n```md\n![c](/f/file_3)\n```\n![d](/f/file_4)',
      ),
    ).toEqual(['/f/file_4']);
  });

  it('ignores plain links and text without images', () => {
    expect(collectMarkdownImageUrls('see [the file](https://app.lobehub.com/f/file_1)')).toEqual(
      [],
    );
    expect(collectMarkdownImageUrls('just text')).toEqual([]);
    expect(collectMarkdownImageUrls(undefined)).toEqual([]);
  });
});

describe('resolveInlineImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the user's pasted images to signed URLs", async () => {
    mocks.resolveFileIdsFromUrls.mockResolvedValue(['file_VbV3vFGeXLTN']);
    mocks.resolveAttachmentMetadata.mockResolvedValue([
      {
        fileType: 'image/png',
        id: 'file_VbV3vFGeXLTN',
        name: 'image.png',
        size: 1,
        url: 'https://bucket.example.com/files/1.png?X-Amz-Signature=s',
      },
    ]);

    await expect(resolveInlineImages(ctx, pasted)).resolves.toEqual([
      {
        id: 'file_VbV3vFGeXLTN',
        url: 'https://bucket.example.com/files/1.png?X-Amz-Signature=s',
      },
    ]);
    expect(mocks.resolveFileIdsFromUrls).toHaveBeenCalledWith(
      ['https://app.lobehub.com/f/file_VbV3vFGeXLTN'],
      { db: ctx.db, userId: 'user-1', workspaceId: 'ws-1' },
    );
    expect(mocks.resolveAttachmentMetadata).toHaveBeenCalledWith({
      db: ctx.db,
      fileIds: ['file_VbV3vFGeXLTN'],
      userId: 'user-1',
      workspaceId: 'ws-1',
    });
  });

  it('drops non-image files and images already attached', async () => {
    mocks.resolveFileIdsFromUrls.mockResolvedValue(['file_attached', 'file_doc']);
    mocks.resolveAttachmentMetadata.mockResolvedValue([
      { fileType: 'application/pdf', id: 'file_doc', name: 'a.pdf', size: 1, url: 'https://x/a' },
    ]);

    await expect(
      resolveInlineImages(ctx, '![a](/f/file_attached) ![d](/f/file_doc)', ['file_attached']),
    ).resolves.toEqual([]);
    expect(mocks.resolveAttachmentMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ fileIds: ['file_doc'] }),
    );
  });

  it('does not touch the database without images', async () => {
    await expect(resolveInlineImages(ctx, 'plain text')).resolves.toEqual([]);
    expect(mocks.resolveFileIdsFromUrls).not.toHaveBeenCalled();
  });
});
