export interface FileUploadErrorDetails {
  code?: string;
  description: string;
}

export interface HandleFileUploadErrorOptions {
  onUploadBlocked?: (details: FileUploadErrorDetails) => void;
}

export const handleFileUploadError = (_error: unknown, _options?: HandleFileUploadErrorOptions) =>
  false;
