export type FileOpErrorKind = 'offline' | 'reason' | 'trashUnsupported' | 'unsupported';

export interface FileOpError {
  kind: FileOpErrorKind;
  /** The host's own message, used as the reason for `kind: 'reason'`. */
  message: string;
}

// Mirrors TRASH_UNSUPPORTED_MESSAGE in @lobechat/device-control: a device
// without a recoverable trash (the `lh connect` daemon) refuses to delete.
const TRASH_UNSUPPORTED = 'does not support moving files to the trash';
// A device whose client predates the RPC.
const UNKNOWN_METHOD = 'Unknown device RPC method';
const OFFLINE =
  /DEVICE_NOT_FOUND|DEVICE_OFFLINE|device (?:is )?offline|desktop offline|not connected/i;

const toMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error ?? '');
};

/** Sorts a failed file operation into the cases the Files panel words differently. */
export const classifyFileOpError = (error: unknown): FileOpError => {
  const message = toMessage(error);
  if (message.includes(TRASH_UNSUPPORTED)) return { kind: 'trashUnsupported', message };
  if (message.includes(UNKNOWN_METHOD)) return { kind: 'unsupported', message };
  if (OFFLINE.test(message)) return { kind: 'offline', message };
  return { kind: 'reason', message };
};
