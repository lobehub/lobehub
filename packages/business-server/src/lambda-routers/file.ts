import type { Transaction } from '@/database/type';

export interface BusinessFileUploadCheckParams {
  actualSize: number;
  clientIp?: string;
  inputSize: number;
  transaction?: Transaction;
  url: string;
  userId: string;
  workspaceId?: string | null;
}

export async function businessFileUploadCheck(
  _params: BusinessFileUploadCheckParams,
): Promise<void> {}

export interface BusinessFileTransferStorageCheckParams {
  additionalSize: number;
  targetUserId: string;
  targetWorkspaceId: string | null;
}

export async function businessFileTransferStorageCheck(
  _params: BusinessFileTransferStorageCheckParams,
): Promise<void> {}

export interface BusinessFileStorageQuota {
  includedBytes: number;
  remainingBytes: number;
  usedBytes: number;
  /** Set when the quota belongs to a workspace rather than the caller. */
  workspaceId?: string;
}

/** Storage quota of the caller's scope; `null` when this deployment has no quota. */
export async function businessGetFileStorageQuota(_params: {
  userId: string;
  workspaceId?: string | null;
}): Promise<BusinessFileStorageQuota | null> {
  return null;
}
