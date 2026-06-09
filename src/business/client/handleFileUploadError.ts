export interface HandleFileUploadErrorOptions {
  onUploadBlocked?: () => void;
}

export const handleFileUploadError = (_error: unknown, _options?: HandleFileUploadErrorOptions) =>
  false;
