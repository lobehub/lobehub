/** Permanent: stored in message history. */
export const WorkIdentifier = 'lobe-work';

export const WorkApiName = {
  createWork: 'createWork',
  deleteWork: 'deleteWork',
  updateWork: 'updateWork',
} as const;

export type WorkApiNameType = (typeof WorkApiName)[keyof typeof WorkApiName];

/** One collection image as the model names it. */
export interface WorkImageArg {
  caption?: string;
  /** A `generationId` (`gen_…`) from image generation, a file id (`file_…`) or a `/f/file_…` link. */
  image: string;
}

export interface CreateWorkArgs {
  /** One of `items[].image`; the first image when left out. Collection only. */
  coverImage?: string;
  description?: string;
  /** Collection images in display order. Required for a collection. */
  items?: WorkImageArg[];
  title: string;
  type: 'collection' | 'link';
  /** http(s) link. Required for a link. */
  url?: string;
}

export interface UpdateWorkArgs {
  coverImage?: string;
  description?: string;
  /** The complete new image list; replaces the current one. Collection only. */
  items?: WorkImageArg[];
  title?: string;
  workId: string;
}

export interface DeleteWorkArgs {
  workId: string;
}

/** A Work as the model and the inspector see it after a create or update. */
export interface WorkSummary {
  /** Number of images; collection only. */
  imageCount?: number;
  title: string | null;
  /** `file` only for a file Work the CLI created and this tool renamed. */
  type: 'collection' | 'file' | 'link';
  url?: string | null;
  workId: string;
}

export interface WorkState {
  work: WorkSummary;
}

export interface DeleteWorkState {
  deleted: { title: string | null; workId: string };
}

export const WORK_TOOL_ERROR_CODES = [
  'conflict',
  'forbidden',
  'invalid_input',
  'not_found',
  'unavailable',
  'unknown',
] as const;

export type WorkToolErrorCode = (typeof WORK_TOOL_ERROR_CODES)[number];

export interface WorkToolErrorState {
  error: { code: WorkToolErrorCode; message: string };
}
