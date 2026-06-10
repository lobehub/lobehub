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
