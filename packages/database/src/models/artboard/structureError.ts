export type ArtboardStructureErrorCode =
  | 'invalid'
  | 'last_page'
  | 'missing_choice'
  | 'not_empty'
  | 'not_found'
  | 'round_submitted'
  | 'rounds_changed';

export class ArtboardStructureError extends Error {
  constructor(
    public code: ArtboardStructureErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const fail = (code: ArtboardStructureErrorCode, message: string): never => {
  throw new ArtboardStructureError(code, message);
};
