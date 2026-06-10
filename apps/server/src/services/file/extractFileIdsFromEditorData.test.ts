import { describe, expect, it, vi } from 'vitest';

import {
  collectAttachmentUrlsFromEditorData,
  extractFileIdsFromEditorData,
} from './extractFileIdsFromEditorData';

const image = (src: string, status?: string) => ({
  altText: '',
  src,
  ...(status !== undefined ? { status } : {}),
  type: 'block-image',
});

const file = (fileUrl: string, name = 'file', status?: string) => ({
  fileUrl,
  name,
  size: 0,
  ...(status !== undefined ? { status } : {}),
  type: 'file',
});

// Stub a Drizzle chain. `rows` is what the final `.where(...)` resolves to.
const mockDb = (rows: { id: string; url?: string }[]) => {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, _where: where } as any;
};

describe('collectAttachmentUrlsFromEditorData', () => {
  it('returns [] for null / undefined / empty inputs', () => {
    expect(collectAttachmentUrlsFromEditorData(null)).toEqual([]);
    expect(collectAttachmentUrlsFromEditorData(undefined)).toEqual([]);
    expect(collectAttachmentUrlsFromEditorData({})).toEqual([]);
    expect(collectAttachmentUrlsFromEditorData({ root: { children: [] } })).toEqual([]);
  });

  it('collects src from images and fileUrl from files, recursively', () => {
    const json = {
      root: {
        children: [
          {
            children: [image('https://app.lobehub.com/f/file_nested')],
            type: 'paragraph',
          },
          file('https://app.lobehub.com/f/file_pdf', 'doc.pdf'),
        ],
      },
    };
    expect(collectAttachmentUrlsFromEditorData(json)).toEqual([
      'https://app.lobehub.com/f/file_nested',
      'https://app.lobehub.com/f/file_pdf',
    ]);
  });

  it('treats missing status as uploaded; skips loading / error', () => {
    const json = {
      root: {
        children: [
          image('http://localhost:3010/f/file_ok'),
          image('http://localhost:3010/f/file_loading', 'loading'),
          image('http://localhost:3010/f/file_failed', 'error'),
        ],
      },
    };
    expect(collectAttachmentUrlsFromEditorData(json)).toEqual(['http://localhost:3010/f/file_ok']);
  });
});

describe('extractFileIdsFromEditorData', () => {
  const ctx = { db: mockDb([]), userId: 'usr_1' };

  it('returns [] for empty input without touching the DB', async () => {
    const db = mockDb([]);
    await expect(extractFileIdsFromEditorData(null, { db, userId: 'u' })).resolves.toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('extracts fileIds from proxy URLs without DB query', async () => {
    const db = mockDb([]);
    const json = {
      root: {
        children: [
          image('http://localhost:3010/f/file_a'),
          file('http://localhost:3010/f/file_b', 'b.pdf'),
        ],
      },
    };
    const result = await extractFileIdsFromEditorData(json, { db, userId: 'u' });
    expect(result.sort()).toEqual(['file_a', 'file_b']);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('falls back to DB lookup by storage key for pre-signed URLs', async () => {
    const db = mockDb([{ id: 'file_resolved' }]);
    const json = {
      root: {
        children: [
          image(
            'https://use-for-dev.r2.cloudflarestorage.com/ppp/494360/03378b6c.jpg?X-Amz-Date=…',
          ),
        ],
      },
    };
    const result = await extractFileIdsFromEditorData(json, { db, userId: 'u' });
    expect(result).toEqual(['file_resolved']);
    expect(db.select).toHaveBeenCalledOnce();
  });

  it('mixes proxy + signed URLs and dedupes', async () => {
    const db = mockDb([{ id: 'file_signed_one' }]);
    const json = {
      root: {
        children: [
          image('http://localhost:3010/f/file_a'),
          image('http://localhost:3010/f/file_a'), // dup
          image('https://r2.example.com/users/u/files/abc.jpg?X-Amz-Date=…'),
        ],
      },
    };
    const result = await extractFileIdsFromEditorData(json, { db, userId: 'u' });
    expect(result.sort()).toEqual(['file_a', 'file_signed_one']);
  });

  it('dedupes when the same storage key resolves to multiple file rows', async () => {
    // Same image re-uploaded by the user → 3 file rows, identical `url`.
    const db = mockDb([
      { id: 'file_a', url: 'ppp/494/abc.jpg' },
      { id: 'file_b', url: 'ppp/494/abc.jpg' },
      { id: 'file_c', url: 'ppp/494/abc.jpg' },
    ]);
    const json = {
      root: {
        children: [image('https://r2.example.com/ppp/494/abc.jpg?X-Amz-Date=…')],
      },
    };
    const result = await extractFileIdsFromEditorData(json, { db, userId: 'u' });
    expect(result).toEqual(['file_a']); // one per unique storage key
  });

  it('skips unparseable URLs without crashing', async () => {
    const db = mockDb([]);
    const json = {
      root: {
        children: [image('not-a-real-url')],
      },
    };
    await expect(extractFileIdsFromEditorData(json, { db, userId: 'u' })).resolves.toEqual([]);
  });

  it('skips non-uploaded entries', async () => {
    const db = mockDb([]);
    const json = {
      root: {
        children: [
          image('http://localhost:3010/f/file_skip', 'loading'),
          image('http://localhost:3010/f/file_keep'),
        ],
      },
    };
    const result = await extractFileIdsFromEditorData(json, { db, userId: 'u' });
    expect(result).toEqual(['file_keep']);
  });

  void ctx; // silence unused
});
