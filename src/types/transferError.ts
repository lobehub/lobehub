export const TransferErrorCode = {
  FileStorageLimitExceeded: 'FILE_STORAGE_LIMIT_EXCEEDED',
  NoPermission: 'NO_PERMISSION',
  OwnerOnly: 'OWNER_ONLY',
  ResourceNotFound: 'RESOURCE_NOT_FOUND',
  SameWorkspace: 'SAME_WORKSPACE',
  TargetNoWriteAccess: 'TARGET_NO_WRITE_ACCESS',
} as const;

export type TransferErrorCode = (typeof TransferErrorCode)[keyof typeof TransferErrorCode];
