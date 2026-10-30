import { describe, expect, it } from 'vitest';

import {
  buildFilePath,
  buildLibraryPath,
  buildPagePath,
  legacyLibraryItemRedirect,
  LIBRARY_ITEM_PATH,
  libraryItemPath,
} from './resourcePath';

/** @example Links and detail windows built by hand land inside the workspace. */
describe('resourcePath', () => {
  // ROOT CAUSE:
  //
  // Hand-built resource URLs (copy link, library "detail", post-create landing)
  // bypassed `useWorkspaceAwareNavigate` and were emitted as `/resource…` even
  // inside a workspace, whose routes are mounted under `/:workspaceSlug`.
  describe('buildLibraryPath', () => {
    it('prefixes the library path with the active workspace slug', () => {
      expect(buildLibraryPath('kb_1', 'acme')).toBe('/acme/resource/library/kb_1');
    });

    it('leaves the personal-scope library path unprefixed', () => {
      expect(buildLibraryPath('kb_1', null)).toBe('/resource/library/kb_1');
    });
  });

  describe('buildFilePath', () => {
    it('opens the file in Docs, inside the active workspace', () => {
      expect(buildFilePath('file_1', 'acme')).toBe('/acme/resource/file/file_1');
      expect(buildFilePath('file_1', null)).toBe('/resource/file/file_1');
    });
  });

  describe('buildPagePath', () => {
    it('prefixes the page path with the active workspace slug', () => {
      expect(buildPagePath('docs_abc', 'acme')).toBe('/acme/resource/page/abc');
    });

    it('keeps a library page inside the workspace', () => {
      expect(buildPagePath('docs_abc', 'acme', 'kb_1')).toBe(
        '/acme/resource/library/kb_1/docs/docs_abc',
      );
    });

    it('leaves the personal-scope page path unprefixed', () => {
      expect(buildPagePath('docs_abc', null)).toBe('/resource/page/abc');
      expect(buildPagePath('docs_abc', undefined, 'kb_1')).toBe(
        '/resource/library/kb_1/docs/docs_abc',
      );
    });
  });

  describe('libraryItemPath', () => {
    it('opens a page under the docs segment', () => {
      expect(libraryItemPath('kb_1', 'docs_abc')).toBe('/resource/library/kb_1/docs/docs_abc');
    });

    it('opens an uploaded file under the file segment', () => {
      expect(libraryItemPath('kb_1', 'file_abc')).toBe('/resource/library/kb_1/file/file_abc');
    });

    it('is recognised as an opened library item, unlike a folder', () => {
      expect(LIBRARY_ITEM_PATH.test('/acme/resource/library/kb_1/docs/docs_abc')).toBe(true);
      expect(LIBRARY_ITEM_PATH.test('/resource/library/kb_1/file/file_abc')).toBe(true);
      expect(LIBRARY_ITEM_PATH.test('/resource/library/kb_1/folder-slug')).toBe(false);
    });
  });

  describe('legacyLibraryItemRedirect', () => {
    it('moves a ?file= link onto the item path, keeping the workspace and other query', () => {
      expect(
        legacyLibraryItemRedirect(
          '/acme/resource/library/kb_1',
          '?file=docs_abc&view=grid',
          'kb_1',
        ),
      ).toEqual({ pathname: '/acme/resource/library/kb_1/docs/docs_abc', search: '?view=grid' });
    });

    it('drops the folder a legacy link was opened from', () => {
      expect(
        legacyLibraryItemRedirect('/resource/library/kb_1/folder-slug', '?file=file_abc', 'kb_1'),
      ).toEqual({ pathname: '/resource/library/kb_1/file/file_abc', search: '' });
    });

    it('leaves non-legacy URLs alone', () => {
      expect(legacyLibraryItemRedirect('/resource/library/kb_1', '?view=grid', 'kb_1')).toBeNull();
    });
  });
});
