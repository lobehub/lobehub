import type { FileUploadItem } from '@lobechat/database/schemas';
import { TRPCError } from '@trpc/server';

import { businessFileUploadCheck } from '@/business/server/lambda-routers/file';
import type { FileUploadModel } from '@/database/models/fileUpload';
import type { LobeChatDatabase, Transaction } from '@/database/type';
import type { FileS3 } from '@/server/modules/S3';
import { FILE_UPLOAD_SESSION_TTL } from '@/server/services/fileUpload';

export const uploadConflict = (message: string) => new TRPCError({ code: 'CONFLICT', message });

const matchesReservation = (
  upload: FileUploadItem | undefined,
  params: { multipartPartSize?: number; size: number },
) =>
  upload?.size === params.size && upload.multipartPartSize === (params.multipartPartSize ?? null);

const isMissingObject = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const value = error as { $metadata?: { httpStatusCode?: number }; name?: string };
  return value.name === 'NotFound' || value.$metadata?.httpStatusCode === 404;
};

/**
 * Reserve an upload pathname for `params.userId` before any credentials are
 * issued: serializes the storage-quota check with the reservation insert so
 * concurrent uploads cannot both slip under the cap.
 *
 * Shared between the owner upload router (`upload.createS3PreSignedUrl` /
 * `createS3MultipartUpload`) and the agent-share visitor upload
 * (`shareChat.createUploadUrl`), where `userId` is the CREATOR rather than the
 * caller — the quota that pays for the bytes is the one that gets reserved.
 */
export const reserveUpload = async (params: {
  clientIp?: string;
  db: LobeChatDatabase;
  model: FileUploadModel;
  multipartPartSize?: number;
  pathname: string;
  size: number;
  storage: Pick<FileS3, 'getFileMetadata'>;
  userId: string;
  workspaceId?: string | null;
}): Promise<FileUploadItem> => {
  const expiresAt = new Date(Date.now() + FILE_UPLOAD_SESSION_TTL);

  return params.db.transaction(async (transaction: Transaction) => {
    const existing = await params.model.findActiveByPathname(params.pathname, transaction);
    if (existing) {
      if (!matchesReservation(existing, params)) {
        throw uploadConflict('Upload pathname is already reserved');
      }

      return (await params.model.touchActive(params.pathname, expiresAt, transaction))!;
    }

    // A reservation authorizes deleting its own pathname on abort, so it must never be
    // granted over an object that already exists and therefore belongs to someone else.
    const objectExists = await params.storage
      .getFileMetadata(params.pathname)
      .then(() => true)
      .catch((error: unknown) => {
        if (isMissingObject(error)) return false;
        throw error;
      });
    if (objectExists) throw uploadConflict('Upload pathname is already in use');

    try {
      await businessFileUploadCheck({
        actualSize: params.size,
        clientIp: params.clientIp,
        inputSize: params.size,
        transaction,
        url: params.pathname,
        userId: params.userId,
        workspaceId: params.workspaceId,
      });
    } catch (error) {
      const concurrent = await params.model.findActiveByPathname(params.pathname, transaction);
      if (matchesReservation(concurrent, params)) return concurrent!;
      throw error;
    }

    const created = await params.model.create(
      {
        expiresAt,
        multipartPartSize: params.multipartPartSize,
        pathname: params.pathname,
        size: params.size,
      },
      transaction,
    );
    if (created) return created;

    const concurrent = await params.model.findActiveByPathname(params.pathname, transaction);
    if (matchesReservation(concurrent, params)) return concurrent!;

    throw uploadConflict('Upload pathname is already reserved');
  });
};
