export const TransferErrorCode = {
  CopyInProgress: 'COPY_IN_PROGRESS',
  FileStorageLimitExceeded: 'FILE_STORAGE_LIMIT_EXCEEDED',
  NoPermission: 'NO_PERMISSION',
  OwnerOnly: 'OWNER_ONLY',
  ResourceNotFound: 'RESOURCE_NOT_FOUND',
  SameWorkspace: 'SAME_WORKSPACE',
  TargetNoWriteAccess: 'TARGET_NO_WRITE_ACCESS',
  TransferInProgress: 'TRANSFER_IN_PROGRESS',
  TransferNotSupported: 'TRANSFER_NOT_SUPPORTED',
} as const;

export type TransferErrorCode = (typeof TransferErrorCode)[keyof typeof TransferErrorCode];
