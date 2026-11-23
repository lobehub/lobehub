import type { ArtboardFinalizeIssue } from '@lobechat/types';

import { ArtboardRevisionConflictError } from '@/database/models/artboard';
import { ArtboardCommentError } from '@/database/models/artboard/comment';
import { ArtboardStructureError } from '@/database/models/artboard/structure';

export type ArtboardServiceErrorCode =
  | 'conflict'
  | 'exists'
  | 'finalize_blocked'
  | 'invalid'
  | 'locked'
  | 'no_project'
  | 'not_found'
  | 'source_denied';

export interface ArtboardServiceErrorData {
  artboardId?: string;
  issues?: ArtboardFinalizeIssue[];
  opIndex?: number;
}

export class ArtboardServiceError extends Error {
  constructor(
    public code: ArtboardServiceErrorCode,
    message: string,
    public data: ArtboardServiceErrorData = {},
  ) {
    super(message);
  }
}

export const failArtboard = (code: ArtboardServiceErrorCode, message: string): never => {
  throw new ArtboardServiceError(code, message);
};

export const artboardConflict = () =>
  new ArtboardServiceError(
    'conflict',
    'The board changed since you read it. Call readArtboard for the latest revision, then retry.',
  );

export const toArtboardServiceError = (error: unknown, opIndex?: number): unknown => {
  const data = opIndex === undefined ? {} : { opIndex };
  if (error instanceof ArtboardServiceError)
    return opIndex === undefined || error.data.opIndex !== undefined
      ? error
      : new ArtboardServiceError(error.code, error.message, { ...error.data, opIndex });
  if (error instanceof ArtboardRevisionConflictError) return artboardConflict();
  if (error instanceof ArtboardStructureError) {
    if (error.code === 'rounds_changed')
      return new ArtboardServiceError(
        'conflict',
        'The questions on this artboard changed. Check them and submit again.',
        data,
      );
    const code =
      error.code === 'not_found'
        ? 'not_found'
        : error.code === 'round_submitted'
          ? 'locked'
          : 'invalid';
    return new ArtboardServiceError(code, error.message, data);
  }
  if (error instanceof ArtboardCommentError)
    return new ArtboardServiceError(error.code, error.message, data);
  return error;
};

export const guardArtboard = async <T>(action: () => Promise<T>): Promise<T> => {
  try {
    return await action();
  } catch (error) {
    throw toArtboardServiceError(error);
  }
};

const ROW_UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

export const requireRowId = (id: string, what: string) => {
  if (!ROW_UUID.test(id)) throw new ArtboardServiceError('not_found', `No ${what} ${id}.`);
};

export const requireText = (content: string) => {
  if (!content.trim()) throw new ArtboardServiceError('invalid', 'A comment needs some text.');
};
