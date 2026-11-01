import { parseWorkGalleryKey, type WorkGalleryKey } from '@/features/WorkGallery/const';
import { FilesTabs } from '@/types/files';
import { getIdFromIdentifier, standardizeIdentifier } from '@/utils/identifier';

/**
 * Docs (`/resource`) has four sections: the home dashboard, the drive (every
 * uploaded file by type), the library gallery and the Works gallery. Paths are
 * written without the workspace prefix; navigation adds it.
 */
export const RESOURCE_HOME_PATH = '/resource';
export const DRIVE_PATH = '/resource/drive';
export const LIBRARY_INDEX_PATH = '/resource/library';
export const WORKS_PATH = '/resource/works';

/** Path segment → drive category: /resource/drive/documents, /resource/drive/images, … */
export const DRIVE_CATEGORY_BY_SEGMENT: Record<string, FilesTabs> = {
  audios: FilesTabs.Audios,
  documents: FilesTabs.Documents,
  files: FilesTabs.Files,
  images: FilesTabs.Images,
  videos: FilesTabs.Videos,
  websites: FilesTabs.Websites,
};

const DRIVE_SEGMENT_BY_CATEGORY = Object.fromEntries(
  Object.entries(DRIVE_CATEGORY_BY_SEGMENT).map(([segment, category]) => [category, segment]),
) as Partial<Record<FilesTabs, string>>;

/** Canonical drive path for a category; the drive root lists every file. */
export const driveCategoryPath = (category: FilesTabs): string => {
  const segment = DRIVE_SEGMENT_BY_CATEGORY[category];
  return segment ? `${DRIVE_PATH}/${segment}` : DRIVE_PATH;
};

/**
 * Where a page opens inside Docs: `/resource/page/<id>`, with the short id the
 * Pages module used (`docs_` prefix dropped), so writing a page never leaves Docs.
 */
export const docsPagePath = (pageId: string): string =>
  `${RESOURCE_HOME_PATH}/page/${encodeURIComponent(standardizeIdentifier(pageId))}`;

/** Where an uploaded file opens inside Docs: `/resource/file/<id>`. */
export const docsFilePath = (fileId: string): string =>
  `${RESOURCE_HOME_PATH}/file/${encodeURIComponent(fileId)}`;

export type ResourceRouteView =
  | { kind: 'home' }
  | { category: FilesTabs; kind: 'drive' }
  | { galleryKey: WorkGalleryKey; kind: 'works' }
  /** A page or file opened over the Docs home; `id` is the full row id. */
  | { id: string; kind: 'file' | 'page' }
  | { kind: 'redirect'; to: string };

/** The segments after `/resource`, ignoring a workspace prefix and trailing slash. */
const resourceSegments = (pathname: string): string[] | null => {
  const match = pathname.match(/\/resource(?:\/(.*))?$/);
  if (!match) return null;
  return match[1] ? match[1].split('/').filter(Boolean) : [];
};

/** Where a pre-Docs URL (`/resource/<category>`, `?category=`, `?works=`) now lives. */
const legacyRedirect = (segments: string[], searchParams: URLSearchParams): string | null => {
  const legacyWorksKey = parseWorkGalleryKey(searchParams.get('works'));
  if (legacyWorksKey && segments[0] !== 'works') {
    return legacyWorksKey === 'all' ? WORKS_PATH : `${WORKS_PATH}?works=${legacyWorksKey}`;
  }

  // The Docs home opened items as `/resource?file=<id>` before they had paths.
  const legacyFile = searchParams.get('file');
  if (legacyFile && segments.length === 0) return docsFilePath(legacyFile);

  const legacyCategory = searchParams.get('category');
  if (legacyCategory && segments.length === 0) {
    return driveCategoryPath(legacyCategory as FilesTabs);
  }

  if (segments.length !== 1) return null;
  const [segment] = segments;
  if (segment === 'all') return DRIVE_PATH;
  // Pages left the drive: they live in the sidebar's My docs / Shared sections.
  if (segment === 'page') return RESOURCE_HOME_PATH;
  if (DRIVE_CATEGORY_BY_SEGMENT[segment]) return `${DRIVE_PATH}/${segment}`;

  return null;
};

/** Resolve what the Docs home route renders for a URL. */
export const resolveResourceRoute = (
  pathname: string,
  searchParams: URLSearchParams,
): ResourceRouteView => {
  const segments = resourceSegments(pathname) ?? [];

  const redirect = legacyRedirect(segments, searchParams);
  if (redirect) return { kind: 'redirect', to: redirect };

  if (segments.length === 0) return { kind: 'home' };

  const [section, sub, ...rest] = segments;

  if (section === 'works' && !sub) {
    return { galleryKey: parseWorkGalleryKey(searchParams.get('works')) ?? 'all', kind: 'works' };
  }

  if ((section === 'page' || section === 'file') && sub && rest.length === 0) {
    const id = decodeURIComponent(sub);
    return { id: section === 'page' ? getIdFromIdentifier(id, 'docs') : id, kind: section };
  }

  if (section === 'drive' && rest.length === 0) {
    if (!sub) return { category: FilesTabs.All, kind: 'drive' };
    const category = DRIVE_CATEGORY_BY_SEGMENT[sub];
    return category ? { category, kind: 'drive' } : { kind: 'redirect', to: DRIVE_PATH };
  }

  return { kind: 'redirect', to: RESOURCE_HOME_PATH };
};

export type DocsSection = 'drive' | 'home' | 'library' | 'works';

/**
 * Which top-level Docs section a pathname belongs to. Business routes under
 * Works are listed by the caller.
 */
export const resolveDocsSection = (
  pathname: string,
  worksPaths: readonly string[] = [],
): DocsSection | null => {
  const segments = resourceSegments(pathname);
  if (!segments) return null;
  const [section] = segments;
  if (!section) return 'home';
  if (section === 'drive') return 'drive';
  if (section === 'library') return 'library';
  if (section === 'works') return 'works';
  if (worksPaths.includes(`${RESOURCE_HOME_PATH}/${section}`)) return 'works';
  return null;
};
