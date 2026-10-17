import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { EnvironmentInstanceModel } from '@/database/models/environmentInstance';
import { resolveSandboxSessionConfig } from '@/server/services/sandbox';

import { instanceProcedure, mapStorageError } from './procedures';
import { idSchema, relativePathSchema, topicIdSchema } from './schemas';

/**
 * Ceiling on a single write. Generous for anything a person edits by hand and
 * small enough that a runaway body is refused before it is buffered — this is
 * an editor's save path, not a bulk upload.
 */
const MAX_FILE_CONTENT_BYTES = 1024 * 1024;

/**
 * Checked in UTF-8 bytes, which is what the cap is denominated in and what the
 * execution plane actually receives. `z.string().max()` counts UTF-16 code
 * units, so a megabyte of CJK would pass it and send roughly three.
 */
const fileContentSchema = z
  .string()
  .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_FILE_CONTENT_BYTES, {
    message: `File content exceeds ${MAX_FILE_CONTENT_BYTES} bytes`,
  });

/**
 * The directory a file route may touch, as a path relative to the workspace
 * root; `''` is the whole root.
 *
 * A workspace's root is shared by every member and holds every instance's
 * directory, so a path alone authorizes nothing: it is confined to one
 * instance, reached through the same rules as everywhere else. Reads follow
 * visibility — a published instance is readable by the members who run in it.
 * Writes stay with the instance's owner, as every other write to an instance
 * does. A conversation's own files are read through the instance its runs
 * resolve to, so a public agent's conversation is held to published ones.
 *
 * A personal account's root belongs to its owner alone, which is the one case
 * where no instance is needed.
 *
 * An instance's directory is never written through here: it is
 * the saved copy of the sandbox's work tree, written by the sandbox alone. A
 * write from outside would be overwritten by the next save, or leave the
 * directory disagreeing with the record the next restore reads it by.
 */
const resolveFileRoot = async (
  ctx: {
    instanceModel: EnvironmentInstanceModel;
    serverDB: Parameters<typeof resolveSandboxSessionConfig>[0]['serverDB'];
    userId: string;
    workspaceId?: string | null;
  },
  { instanceId, topicId }: { instanceId?: string; topicId?: string },
  access: 'read' | 'write',
): Promise<string> => {
  if (instanceId) {
    // Refused before the lookup: the answer is the same whether or not the
    // instance exists, so there is nothing to find out by asking.
    if (access === 'write') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'INSTANCE_READ_ONLY' });
    }
    const instance = await ctx.instanceModel.findById(instanceId);
    if (!instance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });

    return instance.workingDirectory;
  }

  if (!ctx.workspaceId) return '';

  if (access === 'read' && topicId) {
    const { cwd } = await resolveSandboxSessionConfig({
      isShareVisitorRun: false,
      serverDB: ctx.serverDB,
      topicId,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
    if (cwd) return cwd;
  }

  throw new TRPCError({ code: 'FORBIDDEN', message: 'INSTANCE_REQUIRED' });
};

/** Whether `path` is `root` itself or somewhere beneath it. */
const isWithinRoot = (path: string, root: string) =>
  !root || path === root || path.startsWith(`${root}/`);

const assertWithinRoot = (path: string, root: string) => {
  if (!isWithinRoot(path, root)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'PATH_OUTSIDE_INSTANCE' });
  }
};

/** Names the instance a file route works in; see {@link resolveFileRoot}. */
const instanceIdSchema = idSchema.optional();

export const filesProcedures = {
  createDirectory: instanceProcedure
    .input(
      z.object({ instanceId: instanceIdSchema, path: relativePathSchema, topicId: topicIdSchema }),
    )
    .mutation(async ({ ctx, input: { instanceId, ...input } }) => {
      assertWithinRoot(input.path, await resolveFileRoot(ctx, { instanceId }, 'write'));

      return ctx.client.createDirectory(input).catch(mapStorageError);
    }),
  listFiles: instanceProcedure
    .input(
      z.object({
        instanceId: instanceIdSchema,
        path: relativePathSchema.optional(),
        recursive: z.boolean().optional(),
        topicId: topicIdSchema,
      }),
    )
    .query(async ({ ctx, input: { instanceId, ...input } }) => {
      const root = await resolveFileRoot(ctx, { instanceId, topicId: input.topicId }, 'read');
      // No path means "the top of what may be listed", which inside a
      // workspace is the instance's directory, not the shared root.
      const path = input.path ?? (root || undefined);
      if (path !== undefined) assertWithinRoot(path, root);

      return ctx.client.listFiles({ ...input, path }).catch(mapStorageError);
    }),
  readFile: instanceProcedure
    .input(
      z.object({ instanceId: instanceIdSchema, path: relativePathSchema, topicId: topicIdSchema }),
    )
    .query(async ({ ctx, input: { instanceId, ...input } }) => {
      assertWithinRoot(
        input.path,
        await resolveFileRoot(ctx, { instanceId, topicId: input.topicId }, 'read'),
      );

      return ctx.client.readFile(input).catch(mapStorageError);
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
        instanceId: instanceIdSchema,
        path: relativePathSchema,
        topicId: topicIdSchema,
      }),
    )
    .mutation(async ({ ctx, input: { instanceId, ...input } }) => {
      assertWithinRoot(input.path, await resolveFileRoot(ctx, { instanceId }, 'write'));

      return ctx.client.writeFile(input).catch(mapStorageError);
    }),
  removeFile: instanceProcedure
    .input(
      z.object({
        instanceId: instanceIdSchema,
        path: relativePathSchema,
        recursive: z.boolean().optional(),
        topicId: topicIdSchema,
      }),
    )
    .mutation(async ({ ctx, input: { instanceId, ...input } }) => {
      const root = await resolveFileRoot(ctx, { instanceId }, 'write');
      assertWithinRoot(input.path, root);
      // The instance's own directory is its identity, not a file in it:
      // removing it would orphan the row and the snapshot that name it.
      if (root && input.path === root) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'PATH_OUTSIDE_INSTANCE' });
      }

      return ctx.client.deleteFile(input).catch(mapStorageError);
    }),
};
