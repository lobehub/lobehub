/** ASC error codes (spec §8). Messages never include secret material, ciphertext or key bytes. */
export type AscErrorCode =
  | 'BAD_SIGNATURE'
  | 'DECRYPT_FAILED'
  | 'EXPIRED'
  | 'FINGERPRINT_MISMATCH'
  | 'INVALID_ENVELOPE'
  | 'INVALID_REQUEST'
  | 'REPLAYED'
  | 'REQUEST_MISMATCH'
  | 'SECRET_TOO_LARGE'
  | 'SENDER_AUTH_REQUIRED'
  | 'UNKNOWN_SENDER'
  | 'UNSUPPORTED_VERSION';

export class AscError extends Error {
  readonly code: AscErrorCode;

  constructor(code: AscErrorCode, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = 'AscError';
    this.code = code;
  }
}

export const isAscError = (error: unknown, code?: AscErrorCode): error is AscError =>
  error instanceof AscError && (code === undefined || error.code === code);
