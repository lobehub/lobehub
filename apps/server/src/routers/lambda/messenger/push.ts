import { MESSENGER_PUSH_CONTENT_MAX_LENGTH } from '@lobechat/builtin-tool-message';
import { TRPCError } from '@trpc/server';
import pMap from 'p-map';
import { z } from 'zod';

import { FileModel } from '@/database/models/file';
import { router } from '@/libs/trpc/lambda';
import type { BotMessageAttachment } from '@/server/services/bot/platforms/types';
import { FileService } from '@/server/services/file';
import {
  getMessengerPushWindow,
  MESSENGER_PUSH_PLATFORMS,
  sendMessengerPush,
} from '@/server/services/messenger/push';

import { messengerProcedure } from './procedures';

// Each attachment is a file-row read plus a file access URL resolution.
const ATTACHMENT_RESOLVE_CONCURRENCY = 5;

export const pushRouter = router({
  /**
   * Proactive-push window status for the caller's link on a platform:
   * deliverability mode, remaining quota, expiry, and queued messages.
   * Read-only; used by the messenger settings UI.
   */
  getMessengerPushWindow: messengerProcedure
    .input(
      z.object({
        platform: z.enum(MESSENGER_PUSH_PLATFORMS),
        tenantId: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return getMessengerPushWindow({
        platform: input.platform,
        serverDB: ctx.serverDB,
        tenantId: input.tenantId,
        userId: ctx.userId,
      });
    }),
  /**
   * Proactively push a message to the caller's linked messenger account.
   *
   * Platform-agnostic entry (see services/messenger/push): windowed platforms
   * like WeChat deliver inside the current send window and queue outside it —
   * the caller gets `queued`, never a silent drop. This is the low-level
   * capability the notification-channel integration will build on.
   */
  sendMessengerPush: messengerProcedure
    .input(
      z
        .object({
          // Attachments are referenced by `fileId` only — deliberately NOT the
          // `attachmentsInputSchema` shape from botMessage.ts, which also
          // accepts `data` / `fetchUrl`. The platform senders materialize
          // `fetchUrl` with a server-side `fetch`, so accepting one here would
          // let any authenticated caller aim that fetch at an internal address
          // and have the response uploaded into their own DM. Every field the
          // senders need is read from the owned file row below instead.
          attachments: z
            .array(
              z.object({
                fileId: z.string().min(1),
                type: z.enum(['image', 'file', 'video', 'audio']),
              }),
            )
            .max(10)
            .optional(),
          content: z.string().trim().max(MESSENGER_PUSH_CONTENT_MAX_LENGTH).optional(),
          // What to do with an image the platform will not take at full size.
          // Absent means `compress` — the behavior before the choice existed.
          oversizeImageStrategy: z.enum(['compress', 'link']).optional(),
          platform: z.enum(MESSENGER_PUSH_PLATFORMS),
          tenantId: z.string().optional(),
        })
        .refine((value) => !!value.content || !!value.attachments?.length, {
          message: 'Either content or attachments is required',
        }),
    )
    .mutation(async ({ input, ctx }) => {
      let attachments: BotMessageAttachment[] | undefined;

      // Resolve each `fileId` server-side. Two reasons the URL is not taken
      // from the client: a client-held storage URL is a presigned snapshot
      // that expires (typically 2h), so by the time the platform sender
      // fetches it the download can 403 and the attachment silently degrades
      // to a text-only message; and an arbitrary caller-supplied URL would
      // turn the sender's `fetch` into an SSRF primitive. `getFileAccessUrl`
      // returns the stable anonymous file-proxy URL in production (storage URL
      // in dev), and the ownership-scoped lookup keeps callers from attaching
      // other users' files. Name and MIME type come from the same owned row.
      if (input.attachments?.length) {
        const workspaceId = ctx.workspaceId ?? undefined;
        const fileModel = new FileModel(ctx.serverDB, ctx.userId, workspaceId);
        const fileService = new FileService(ctx.serverDB, ctx.userId, workspaceId);

        attachments = await pMap(
          input.attachments,
          async (attachment) => {
            const file = await fileModel.findById(attachment.fileId);
            if (!file) {
              throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
            }

            return {
              fetchUrl: await fileService.getFileAccessUrl({ id: file.id, url: file.url }),
              // Built here from a row this caller was checked to own, so the
              // outbound guard may accept our own configured origins for it —
              // which self-hosted storage and dev (localhost storage URL) need.
              trustedUrl: true,
              mimeType: file.fileType,
              name: file.name,
              // Byte size from the owned row — the send path uses it to apply
              // per-platform budgets (compress / degrade-to-link) without
              // having to download URL-sourced attachments first.
              size: file.size,
              type: attachment.type,
            };
          },
          { concurrency: ATTACHMENT_RESOLVE_CONCURRENCY },
        );
      }

      return sendMessengerPush({
        attachments,
        content: input.content,
        oversizeImageStrategy: input.oversizeImageStrategy,
        platform: input.platform,
        serverDB: ctx.serverDB,
        tenantId: input.tenantId,
        userId: ctx.userId,
      });
    }),
});
