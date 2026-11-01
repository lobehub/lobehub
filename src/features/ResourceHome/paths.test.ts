import { describe, expect, it } from 'vitest';

import { FilesTabs } from '@/types/files';

import {
  docsFilePath,
  docsPagePath,
  driveCategoryPath,
  resolveDocsSection,
  resolveResourceRoute,
} from './paths';

const route = (pathname: string, search = '') =>
  resolveResourceRoute(pathname, new URLSearchParams(search));

describe('resolveResourceRoute', () => {
  it('renders the home dashboard at the Docs root', () => {
    expect(route('/resource')).toEqual({ kind: 'home' });
    expect(route('/team/resource/')).toEqual({ kind: 'home' });
  });

  it('lists every file at the drive root', () => {
    expect(route('/resource/drive')).toEqual({ category: FilesTabs.All, kind: 'drive' });
  });

  it.each([
    ['documents', FilesTabs.Documents],
    ['images', FilesTabs.Images],
    ['videos', FilesTabs.Videos],
    ['audios', FilesTabs.Audios],
    ['files', FilesTabs.Files],
    ['websites', FilesTabs.Websites],
  ])('resolves the drive %s category', (segment, category) => {
    expect(route(`/team/resource/drive/${segment}`)).toEqual({ category, kind: 'drive' });
  });

  it('sends an unknown drive category back to the drive root', () => {
    expect(route('/resource/drive/bogus')).toEqual({ kind: 'redirect', to: '/resource/drive' });
  });

  it('resolves the Works gallery and its narrowing key', () => {
    expect(route('/resource/works')).toEqual({ galleryKey: 'all', kind: 'works' });
    expect(route('/resource/works', 'works=task')).toEqual({ galleryKey: 'task', kind: 'works' });
  });

  it.each([
    ['/resource/all', '/resource/drive'],
    ['/resource/images', '/resource/drive/images'],
    ['/team/resource/documents', '/resource/drive/documents'],
    ['/resource/page', '/resource'],
  ])('redirects the legacy %s path to %s', (pathname, to) => {
    expect(route(pathname)).toEqual({ kind: 'redirect', to });
  });

  it('redirects legacy query parameters', () => {
    expect(route('/resource', 'category=images')).toEqual({
      kind: 'redirect',
      to: '/resource/drive/images',
    });
    expect(route('/resource', 'works=document')).toEqual({
      kind: 'redirect',
      to: '/resource/works?works=document',
    });
  });

  it('sends an unknown section home', () => {
    expect(route('/resource/bogus')).toEqual({ kind: 'redirect', to: '/resource' });
  });
});

describe('driveCategoryPath', () => {
  it('maps the all-files view to the drive root', () => {
    expect(driveCategoryPath(FilesTabs.All)).toBe('/resource/drive');
    expect(driveCategoryPath(FilesTabs.Images)).toBe('/resource/drive/images');
  });
});

describe('resolveDocsSection', () => {
  it.each([
    ['/resource', 'home'],
    ['/team/resource/drive/images', 'drive'],
    ['/resource/library', 'library'],
    ['/resource/library/kb-1/folder', 'library'],
    ['/resource/works', 'works'],
  ])('maps %s to %s', (pathname, section) => {
    expect(resolveDocsSection(pathname)).toBe(section);
  });

  it('treats business Works routes as part of Works', () => {
    expect(resolveDocsSection('/team/resource/extra', ['/resource/extra'])).toBe('works');
    expect(resolveDocsSection('/resource/extra')).toBeNull();
  });
});

describe('docsPagePath / docsFilePath', () => {
  it('opens a page at /resource/page/<short id> instead of the Pages module', () => {
    expect(docsPagePath('docs_abc')).toBe('/resource/page/abc');
  });

  it('opens a file at /resource/file/<id>', () => {
    expect(docsFilePath('file_1')).toBe('/resource/file/file_1');
  });
});

describe('resolveResourceRoute — opened items', () => {
  it('resolves a page path back to the full document id', () => {
    expect(route('/team/resource/page/abc')).toEqual({ id: 'docs_abc', kind: 'page' });
    expect(route('/resource/page/docs_abc')).toEqual({ id: 'docs_abc', kind: 'page' });
  });

  it('resolves a file path', () => {
    expect(route('/resource/file/file_1')).toEqual({ id: 'file_1', kind: 'file' });
  });

  it('moves the legacy ?file= home link to the file path', () => {
    expect(route('/resource', 'file=docs_abc')).toEqual({
      kind: 'redirect',
      to: '/resource/file/docs_abc',
    });
  });

  it('keeps the bare legacy /resource/page going home', () => {
    expect(route('/resource/page')).toEqual({ kind: 'redirect', to: '/resource' });
  });
});
