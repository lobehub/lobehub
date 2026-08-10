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
  ImageGeneration = 'image_generation',
  PageEditor = 'page-editor',
  VideoGeneration = 'video_generation',
}

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
