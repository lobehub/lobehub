import type { ArtboardCommentThreadView, ArtboardContent, ArtboardPhase } from '@lobechat/types';

export const ArtboardIdentifier = 'builtin-artboard';

export const ArtboardApiName = {
  askArtboardQuestion: 'askArtboardQuestion',
  createArtboard: 'createArtboard',
  listArtboardComments: 'listArtboardComments',
  listArtboards: 'listArtboards',
  readArtboard: 'readArtboard',
  readArtboardFile: 'readArtboardFile',
  replyArtboardComment: 'replyArtboardComment',
  resolveArtboardComment: 'resolveArtboardComment',
  updateArtboard: 'updateArtboard',
  writeArtboardFiles: 'writeArtboardFiles',
} as const;

export type ArtboardApiNameType = (typeof ArtboardApiName)[keyof typeof ArtboardApiName];

export interface ArtboardFilesParams {
  deletes?: unknown[];
  edits?: unknown[];
  writes?: unknown[];
}

export interface CreateArtboardParams {
  description?: string;
  files?: ArtboardFilesParams;
  ops?: unknown[];
  taskId?: string;
  title: string;
}

export interface UpdateArtboardParams {
  files?: ArtboardFilesParams;
  id: string;
  ops?: unknown[];
  revision: number;
}

export interface WriteArtboardFilesParams extends ArtboardFilesParams {
  id: string;
}

export interface ReadArtboardFileParams {
  id: string;
  path: string;
}

export interface ArtboardToolFile {
  hash: string;
  path: string;
  size: number;
}

export interface ReadArtboardParams {
  id: string;
}

export interface ListArtboardCommentsParams {
  id: string;
}

export interface ReplyArtboardCommentParams {
  commentId: string;
  content: string;
}

export interface ResolveArtboardCommentParams {
  commentId: string;
}

export interface AskArtboardQuestionParams {
  boardId?: string;
  content: string;
  groupId?: string;
  id: string;
  pageId?: string;
}

export interface ArtboardToolSnapshot {
  content: ArtboardContent;
  description: string | null;
  id: string;
  phase: ArtboardPhase;
  projectId: string | null;
  revision: number;
  taskId: string | null;
  title: string;
}

export interface ArtboardToolFailure {
  code: string;
  message: string;
  ok: false;
}

export type ArtboardToolWriteOutcome =
  | {
      artboard: ArtboardToolSnapshot;
      changedIds: string[];
      ok: true;
      task?: { createdTask: boolean; identifier: string };
    }
  | ArtboardToolFailure;

export type ArtboardToolReadOutcome =
  | {
      artboard: ArtboardToolSnapshot;
      files: ArtboardToolFile[];
      ok: true;
    }
  | ArtboardToolFailure;

/** Paths written or deleted. */
export type ArtboardToolFilesOutcome = { ok: true; paths: string[] } | ArtboardToolFailure;

export type ArtboardToolFileOutcome =
  { content: string | null; ok: true; path: string } | ArtboardToolFailure;

export type ArtboardToolListOutcome =
  | {
      artboards: Pick<ArtboardToolSnapshot, 'id' | 'phase' | 'revision' | 'taskId' | 'title'>[];
      ok: true;
    }
  | ArtboardToolFailure;

export type ArtboardToolCommentsOutcome =
  { ok: true; threads: ArtboardCommentThreadView[] } | ArtboardToolFailure;

export type ArtboardToolCommentOutcome = { commentId: string; ok: true } | ArtboardToolFailure;

export interface ArtboardToolService {
  askQuestion: (params: AskArtboardQuestionParams) => Promise<ArtboardToolCommentOutcome>;
  create: (params: CreateArtboardParams) => Promise<ArtboardToolWriteOutcome>;
  list: () => Promise<ArtboardToolListOutcome>;
  listComments: (params: ListArtboardCommentsParams) => Promise<ArtboardToolCommentsOutcome>;
  read: (params: ReadArtboardParams) => Promise<ArtboardToolReadOutcome>;
  readFile: (params: ReadArtboardFileParams) => Promise<ArtboardToolFileOutcome>;
  replyComment: (params: ReplyArtboardCommentParams) => Promise<ArtboardToolCommentOutcome>;
  resolveComment: (params: ResolveArtboardCommentParams) => Promise<ArtboardToolCommentOutcome>;
  update: (params: UpdateArtboardParams) => Promise<ArtboardToolWriteOutcome>;
  writeFiles: (params: WriteArtboardFilesParams) => Promise<ArtboardToolFilesOutcome>;
}

export interface ArtboardToolState {
  artboardId: string;
  boardCount: number;
  changedIds: string[];
  groupCount: number;
  phase: ArtboardPhase;
  revision: number;
  title: string;
}
