export enum FilesTabs {
  All = 'all',
  Audios = 'audios',
  Documents = 'documents',
  /**
   * Raw data files that are neither media nor human-readable documents,
   * e.g. json / zip / octet-stream uploads.
   */
  Files = 'files',
  Home = 'home',
  Images = 'images',
  Pages = 'pages',
  Videos = 'videos',
  Websites = 'websites',
}

export enum FileSource {
  /**
   * Evidence artifact backing an acceptance check — a screenshot, execution log
   * or DOM snapshot produced by a verification run. Owned by the report, not by
   * the user's library.
   */
  Acceptance = 'acceptance',
  ImageGeneration = 'image_generation',
  PageEditor = 'page-editor',
  VideoGeneration = 'video_generation',
}

/**
 * Sources whose files are attachments of some other surface rather than library
 * resources. They stay fully readable through the surface that owns them (an
 * acceptance report renders its evidence via `verify_evidence.file_id`), but
 * never show up in the resource library listings — a single verification run
 * uploads hundreds of artifacts and would otherwise bury real content.
 *
 * The one way back in is an explicit `ResourceSourceFilter.Acceptance` request:
 * the user asked for evidence, so burying it no longer applies.
 */
export const LIBRARY_HIDDEN_FILE_SOURCES: FileSource[] = [FileSource.Acceptance];

/** Sources a generation model wrote, as opposed to anything a human put there. */
export const AI_GENERATED_FILE_SOURCES: FileSource[] = [
  FileSource.ImageGeneration,
  FileSource.VideoGeneration,
];

const FILE_SOURCE_VALUES = new Set<string>(Object.values(FileSource));

/**
 * Narrow a caller-supplied source to a known value.
 *
 * Uploads carry `source` as a free-form string on the wire (older clients are
 * out there and a rejected upload over an attribution hint is a bad trade), so
 * an unrecognised value is dropped rather than persisted or thrown on.
 */
export const toFileSource = (source?: string | null): FileSource | undefined =>
  source && FILE_SOURCE_VALUES.has(source) ? (source as FileSource) : undefined;

export interface FileItem {
  content?: string;
  createdAt: Date;
  enabled?: boolean;
  id: string;
  name: string;
  size: number;
  source?: FileSource | null;
  type: string;
  updatedAt: Date;
  url: string;
}

export * from './list';
export * from './upload';
