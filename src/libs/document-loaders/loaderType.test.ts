import { describe, expect, it } from 'vitest';

import { getChunkingLoaderType, isChunkingSupported } from './loaderType';

describe('getChunkingLoaderType', () => {
  it('resolves the loader the chunker dispatches on', () => {
    expect(getChunkingLoaderType('Report.PDF')).toBe('pdf');
    expect(getChunkingLoaderType('slides.pptx')).toBe('ppt');
    expect(getChunkingLoaderType('notes.md')).toBe('markdown');
    expect(getChunkingLoaderType('main.go')).toBe('code');
    expect(getChunkingLoaderType('data.csv')).toBe('csv');
    expect(getChunkingLoaderType('Report.XLSX')).toBe('excel');
  });

  it('returns undefined for formats without a chunking loader', () => {
    expect(getChunkingLoaderType('floor-plan.dwg')).toBeUndefined();
    expect(getChunkingLoaderType('photo.png')).toBeUndefined();
    expect(getChunkingLoaderType('legacy.xls')).toBeUndefined();
    expect(getChunkingLoaderType('no-extension')).toBeUndefined();
  });
});

describe('isChunkingSupported', () => {
  // https://github.com/lobehub/lobehub/issues/19620
  it('rejects unknown extensions even when the MIME type is generic or empty', () => {
    expect(isChunkingSupported({ fileType: 'application/octet-stream', name: 'a.dwg' })).toBe(
      false,
    );
    expect(isChunkingSupported({ fileType: '', name: 'a.dwg' })).toBe(false);
  });

  it('follows the parser registry rather than the MIME prefix when the name is known', () => {
    expect(isChunkingSupported({ fileType: '', name: 'data.xlsx' })).toBe(true);
    // browsers report `.ts` as MPEG transport stream video
    expect(isChunkingSupported({ fileType: 'video/mp2t', name: 'index.ts' })).toBe(true);
    expect(isChunkingSupported({ fileType: 'application/pdf', name: 'paper.pdf' })).toBe(true);
  });

  it('falls back to the MIME heuristic when the name is missing', () => {
    expect(isChunkingSupported({ fileType: 'image/png' })).toBe(false);
    expect(isChunkingSupported({ fileType: 'application/pdf', name: null })).toBe(true);
  });
});
