export type CanvasStorageQuotaResult = { message: string; ok: false } | { ok: true };

export const checkCanvasStorageQuota = async (_params: {
  addedBytes: number;
  userId: string;
  workspaceId?: string | null;
}): Promise<CanvasStorageQuotaResult> => ({ ok: true });
