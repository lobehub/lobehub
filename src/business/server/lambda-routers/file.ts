import type { Transaction } from '@/database/type';

export interface BusinessFileUploadCheckParams {
  actualSize: number;
  clientIp?: string;
  inputSize: number;
  transaction?: Transaction;
  url: string;
  userId: string;
}

export async function businessFileUploadCheck(
  _params: BusinessFileUploadCheckParams,
): Promise<void> {}
