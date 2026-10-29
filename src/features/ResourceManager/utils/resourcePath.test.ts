import { describe, expect, it } from 'vitest';

import { buildFilePath, buildLibraryPath, buildPagePath } from './resourcePath';

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
        '/acme/resource/library/kb_1?file=docs_abc',
      );
    });

    it('leaves the personal-scope page path unprefixed', () => {
      expect(buildPagePath('docs_abc', null)).toBe('/resource/page/abc');
      expect(buildPagePath('docs_abc', undefined, 'kb_1')).toBe(
        '/resource/library/kb_1?file=docs_abc',
      );
    });
  });
});
