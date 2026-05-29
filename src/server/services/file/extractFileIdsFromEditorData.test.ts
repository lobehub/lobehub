import { describe, expect, it } from 'vitest';

import { extractFileIdsFromEditorData } from './extractFileIdsFromEditorData';

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

describe('extractFileIdsFromEditorData', () => {
  it('returns [] for null / undefined / empty inputs', () => {
    expect(extractFileIdsFromEditorData(null)).toEqual([]);
    expect(extractFileIdsFromEditorData(undefined)).toEqual([]);
    expect(extractFileIdsFromEditorData({})).toEqual([]);
    expect(extractFileIdsFromEditorData({ root: { children: [] } })).toEqual([]);
  });

  it('extracts fileId from a block-image src with the proxy URL form', () => {
    const json = {
      root: {
        children: [
          { children: [], type: 'paragraph' },
          image('http://localhost:3010/f/file_abc123'),
        ],
      },
    };
    expect(extractFileIdsFromEditorData(json)).toEqual(['file_abc123']);
  });

  it('extracts fileId from image and file nodes', () => {
    const json = {
      root: {
        children: [
          image('https://app.lobehub.com/f/file_image_1'),
          file('https://app.lobehub.com/f/file_pdf_2', 'report.pdf'),
        ],
      },
    };
    expect(extractFileIdsFromEditorData(json).sort()).toEqual(['file_image_1', 'file_pdf_2']);
  });

  it('recurses into nested children', () => {
    const json = {
      root: {
        children: [
          {
            children: [image('https://app.lobehub.com/f/file_nested')],
            type: 'paragraph',
          },
        ],
      },
    };
    expect(extractFileIdsFromEditorData(json)).toEqual(['file_nested']);
  });

  it('deduplicates repeated fileIds', () => {
    const json = {
      root: {
        children: [
          image('https://app.lobehub.com/f/file_x'),
          image('https://app.lobehub.com/f/file_x'),
          file('https://app.lobehub.com/f/file_x'),
        ],
      },
    };
    expect(extractFileIdsFromEditorData(json)).toEqual(['file_x']);
  });

  it('treats a missing status field as uploaded (covers historical data + cloud uploads)', () => {
    const json = {
      root: {
        children: [
          // No `status` field at all — should still count.
          image('http://localhost:3010/f/file_no_status'),
        ],
      },
    };
    expect(extractFileIdsFromEditorData(json)).toEqual(['file_no_status']);
  });

  it('explicit status: "uploaded" also counts', () => {
    const json = {
      root: {
        children: [image('http://localhost:3010/f/file_done', 'uploaded')],
      },
    };
    expect(extractFileIdsFromEditorData(json)).toEqual(['file_done']);
  });

  it('skips entries that are still in-progress / failed', () => {
    const json = {
      root: {
        children: [
          image('http://localhost:3010/f/file_loading', 'loading'),
          image('http://localhost:3010/f/file_failed', 'error'),
          image('http://localhost:3010/f/file_ok'),
        ],
      },
    };
    expect(extractFileIdsFromEditorData(json)).toEqual(['file_ok']);
  });

  it('ignores URLs that do not match the proxy pattern (e.g. raw R2 signed URLs)', () => {
    const json = {
      root: {
        children: [
          // Cloud-style raw R2 signed URL — does not contain `/f/{fileId}`.
          // Tracked as a follow-up: extract via files.url lookup or align
          // cloud's createFile to return the proxy URL.
          image('https://use-for-dev.r2.cloudflarestorage.com/ppp/494457/a3f895d3.png?X-Amz-...'),
          image('https://cdn.example.com/random.png'),
          // Valid mixed in
          image('http://localhost:3010/f/file_valid'),
        ],
      },
    };
    expect(extractFileIdsFromEditorData(json)).toEqual(['file_valid']);
  });
});
