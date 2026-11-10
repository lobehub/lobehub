import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import { forgetDriveFolders, resolveSandboxSessionConfig } from '@/server/services/sandbox';

import { assertReadable, isHidden, resolveDriveScope, resolveWritableScope } from './driveScope';
import { instanceProcedure, mapStorageError } from './procedures';
import { driveSchema, instanceIdSchema, relativePathSchema, topicIdSchema } from './schemas';

/**
 * Ceiling on a single write. Generous for anything a person edits by hand and
 * small enough that a runaway body is refused before it is buffered — this is
 * an editor's save path, not a bulk upload.
 */
export const MAX_FILE_CONTENT_BYTES = 1024 * 1024;

/**
 * Checked in UTF-8 bytes, which is what the cap is denominated in and what the
 * execution plane actually receives. `z.string().max()` counts UTF-16 code
 * units, so a megabyte of CJK would pass it and send roughly three.
 */
export const fileContentSchema = z
  .string()
  .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_FILE_CONTENT_BYTES, {
    message: `File content exceeds ${MAX_FILE_CONTENT_BYTES} bytes`,
  });

export const filesRouter = router({
  /**
   * Create a folder, parents included. Idempotent — an existing folder is a
   * success, so a picker can offer "new folder" without first proving the
   * name is free.
   */
  createDirectory: instanceProcedure
    .input(
      z.object({
        drive: driveSchema,
        instanceId: instanceIdSchema,
        path: relativePathSchema,
        topicId: topicIdSchema,
      }),
    )
    .mutation(async ({ ctx, input: { drive: _drive, instanceId, ...input } }) => {
      const scope = await resolveWritableScope(ctx, { instanceId, path: input.path });

      const created = await scope.client.createDirectory(input).catch(mapStorageError);
      forgetDriveFolders(ctx.claim.key);

      return created;
    }),
  /**
   * One folder's entries — or, with `recursive`, everything under it — with
   * the private environment directories left on the public drive left out.
   *
   * No path means "where this conversation works" when a topic is named and
   * it has a folder or an environment directory, and the drive's root
   * otherwise: the file panel asks the first question, the directory picker
   * the second.
   */
  listFiles: instanceProcedure
    .input(
      z.object({
        drive: driveSchema,
        instanceId: instanceIdSchema,
        path: relativePathSchema.optional(),
        recursive: z.boolean().optional(),
        topicId: topicIdSchema,
      }),
    )
    .query(async ({ ctx, input: { drive: _drive, instanceId, ...input } }) => {
      let scope = await resolveDriveScope(ctx, instanceId);

      let path = input.path ?? (scope.root || undefined);
      if (path === undefined && input.topicId && !instanceId) {
        const placement = await resolveSandboxSessionConfig({
          isShareVisitorRun: false,
          serverDB: ctx.serverDB,
          topicId: input.topicId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        if (placement.mode !== 'ephemeral') {
          path = placement.cwd;
          // The conversation's folder is on the drive it resolved to — an
          // environment directory's own drive, say — which is not
          // necessarily the one this call was routed by.
          if (placement.drive !== ctx.drive) {
            const access = await ctx.drives.client(placement.drive);
            if (access) {
              scope = await resolveDriveScope({
                ...ctx,
                claim: access.claim,
                client: access.client,
                drive: placement.drive,
              });
            }
          }
        }
      }
      if (path !== undefined) assertReadable(path, scope);

      const listing = await scope.client.listFiles({ ...input, path }).catch(mapStorageError);
      if (scope.hidden.length === 0) return listing;

      return {
        ...listing,
        entries: listing.entries.filter((entry) => !isHidden(entry.path, scope)),
      };
    }),
  readFile: instanceProcedure
    .input(
      z.object({
        drive: driveSchema,
        instanceId: instanceIdSchema,
        path: relativePathSchema,
        topicId: topicIdSchema,
      }),
    )
    .query(async ({ ctx, input: { drive: _drive, instanceId, ...input } }) => {
      const scope = await resolveDriveScope(ctx, instanceId);
      assertReadable(input.path, scope);

      return scope.client.readFile(input).catch(mapStorageError);
    }),
  /**
   * Rename or move a file or folder. Never overwrites: a destination that is
   * already there is refused, and so is anything touching an environment
   * directory — at either end.
   */
  renameFile: instanceProcedure
    .input(
      z.object({
        drive: driveSchema,
        newPath: relativePathSchema,
        path: relativePathSchema,
        topicId: topicIdSchema,
      }),
    )
    .mutation(async ({ ctx, input: { drive: _drive, ...input } }) => {
      const scope = await resolveWritableScope(ctx, { path: input.path });
      await resolveWritableScope(ctx, { path: input.newPath });

      const renamed = await scope.client.renameFile(input).catch(mapStorageError);
      forgetDriveFolders(ctx.claim.key);

      return renamed;
    }),
  /**
   * Write a file's whole contents, creating it and its parents if needed.
   *
   * Text only, because the execution plane's endpoint carries the body as a
   * JSON string with no encoding field. The cap is this layer's own: the
   * endpoint declares none, and an unbounded string arrives in memory on both
   * sides before anything touches a disk.
   */
  writeFile: instanceProcedure
    .input(
      z.object({
        content: fileContentSchema,
        drive: driveSchema,
        instanceId: instanceIdSchema,
        path: relativePathSchema,
        topicId: topicIdSchema,
      }),
    )
    .mutation(async ({ ctx, input: { drive: _drive, instanceId, ...input } }) => {
      const scope = await resolveWritableScope(ctx, { instanceId, path: input.path });

      return scope.client.writeFile(input).catch(mapStorageError);
    }),
  removeFile: instanceProcedure
    .input(
      z.object({
        drive: driveSchema,
        instanceId: instanceIdSchema,
        path: relativePathSchema,
        recursive: z.boolean().optional(),
        topicId: topicIdSchema,
      }),
    )
    .mutation(async ({ ctx, input: { drive: _drive, instanceId, ...input } }) => {
      const scope = await resolveWritableScope(ctx, { instanceId, path: input.path });

      const removed = await scope.client.deleteFile(input).catch(mapStorageError);
      forgetDriveFolders(ctx.claim.key);

      return removed;
    }),
});
