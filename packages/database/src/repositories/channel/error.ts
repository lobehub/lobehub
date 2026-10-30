export type ChannelErrorCode = 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN' | 'NOT_FOUND';

export class ChannelError extends Error {
  constructor(
    readonly code: ChannelErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ChannelError';
  }
}
