import { describe, expect, it } from 'vitest';

import { extractFileIdsFromEditorData } from './extractFileIdsFromEditorData';

// `extractMediaFromEditorState` from @lobehub/editor only emits items where
// `status === 'uploaded'`, so test fixtures must include that flag.
const uploadedImage = (src: string) => ({
  altText: '',
  src,
  status: 'uploaded',
  type: 'block-image',
});

const uploadedFile = (fileUrl: string, name = 'file') => ({
  fileUrl,
  name,
  size: 0,
  status: 'uploaded',
  type: 'file',
});

describe('extractFileIdsFromEditorData', () => {
  it('returns [] for null / undefined / empty inputs', () => {
    expect(extractFileIdsFromEditorData(null)).toEqual([]);
    expect(extractFileIdsFromEditorData(undefined)).toEqual([]);
    expect(extractFileIdsFromEditorData({})).toEqual([]);
    expect(extractFileIdsFromEditorData({ root: { children: [] } })).toEqual([]);
  });

  it('extracts fileId from a block-image src', () => {
    const json = {
      root: {
        children: [
          { children: [], type: 'paragraph' },
          uploadedImage('https://app.lobehub.com/f/fle_abc123'),
        ],
      },
    };
    expect(extractFileIdsFromEditorData(json)).toEqual(['fle_abc123']);
  });

  it('extracts fileId from image and file nodes', () => {
    const json = {
      root: {
        children: [
          uploadedImage('https://app.lobehub.com/f/fle_image_1'),
          uploadedFile('https://app.lobehub.com/f/fle_pdf_2', 'report.pdf'),
        ],
      },
    };
    expect(extractFileIdsFromEditorData(json).sort()).toEqual(['fle_image_1', 'fle_pdf_2']);
  });

  it('recurses into nested children', () => {
    const json = {
      root: {
        children: [
          {
            children: [uploadedImage('https://app.lobehub.com/f/fle_nested')],
            type: 'paragraph',
          },
        ],
      },
    };
    expect(extractFileIdsFromEditorData(json)).toEqual(['fle_nested']);
  });

  it('deduplicates repeated fileIds', () => {
    const json = {
      root: {
        children: [
          uploadedImage('https://app.lobehub.com/f/fle_x'),
          uploadedImage('https://app.lobehub.com/f/fle_x'),
          uploadedFile('https://app.lobehub.com/f/fle_x'),
        ],
      },
    };
    expect(extractFileIdsFromEditorData(json)).toEqual(['fle_x']);
  });

  it('ignores URLs that do not match the proxy pattern', () => {
    const json = {
      root: {
        children: [
          uploadedImage('https://cdn.example.com/random.png'),
          uploadedImage('https://app.lobehub.com/some-other-path'),
          // Valid one mixed in
          uploadedImage('https://app.lobehub.com/f/fle_valid'),
        ],
      },
    };
    expect(extractFileIdsFromEditorData(json)).toEqual(['fle_valid']);
  });

  it('skips non-uploaded entries', () => {
    const json = {
      root: {
        children: [
          {
            altText: '',
            src: 'https://app.lobehub.com/f/fle_loading',
            status: 'loading',
            type: 'block-image',
          },
          uploadedImage('https://app.lobehub.com/f/fle_uploaded'),
        ],
      },
    };
    expect(extractFileIdsFromEditorData(json)).toEqual(['fle_uploaded']);
  });
});
