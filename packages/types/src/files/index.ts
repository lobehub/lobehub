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
 */
export const LIBRARY_HIDDEN_FILE_SOURCES: FileSource[] = [FileSource.Acceptance];

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
