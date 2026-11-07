import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { requireWorkspaceRoleWhenScoped } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { deviceGateway, isValidDirectoryName } from '@/server/services/deviceGateway';

import {
  assertWorkspaceRootApproved,
  registerDeviceMemoryRoot,
  registerDeviceSkillRoots,
} from '../deviceWorkspaceGuard';
import { assertDeviceOperable } from './guards';
import { deviceProcedure } from './procedures';

const workspaceFileInput = z.object({
  deviceId: z.string(),
  workingDirectory: z.string(),
});

/**
 * `deviceProcedure` that additionally requires `workingDirectory` to be an
 * approved workspace root for the device. Builds the guard into the procedure
 * so every file-mutating route inherits it and can never forget the check —
 * see {@link assertWorkspaceRootApproved} for why the check is necessary.
 */
const workspaceFileProcedure = deviceProcedure.input(workspaceFileInput).use(async (opts) => {
  const { deviceId, workingDirectory } = workspaceFileInput.parse(await opts.getRawInput());
  await assertWorkspaceRootApproved(
    opts.ctx.deviceModel,
    deviceId,
    workingDirectory,
    opts.ctx.workspaceId,
  );
  return opts.next();
});

/**
 * `workspaceFileProcedure` for routes that change files on the device. In a
 * shared workspace a read-only viewer may browse the tree but not alter it, so
 * writes also need at least the `member` role; personal mode stays open.
 */
const workspaceFileWriteProcedure = workspaceFileProcedure.use(
  requireWorkspaceRoleWhenScoped('member'),
);

/**
 * `workspaceFileProcedure` for the publish-asset routes. Their source path may
 * lie outside the approved root (the device confines only a copy's
 * destination), so they can read any file on the device, and a copy also
 * writes into the workspace. Gate them like writes: a read-only viewer must not
 * pull arbitrary files off a shared device. Personal mode stays open.
 */
const workspacePublishProcedure = workspaceFileProcedure.use(
  requireWorkspaceRoleWhenScoped('member'),
);

/**
 * The agent's own `CLAUDE_CONFIG_DIR` / `CLAUDE_CODE_PROJECT_DIR_NAME`, which its
 * runs spread over the device env. Read from the stored agent config, never the
 * request: the memory directory they point at becomes an approved root.
 */
const resolveAgentClaudeMemoryEnv = async (
  ctx: { serverDB: LobeChatDatabase; userId: string; workspaceId?: string },
  agentId: string,
) => {
  const agencyConfig = await new AgentModel(
    ctx.serverDB,
    ctx.userId,
    ctx.workspaceId,
  ).getAgentAgencyConfig(agentId);
  const env = agencyConfig?.heterogeneousProvider?.env;
  if (!env) return undefined;
  return {
    CLAUDE_CODE_PROJECT_DIR_NAME: env.CLAUDE_CODE_PROJECT_DIR_NAME,
    CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR,
  };
};

export const projectFilesRouter = router({
  /**
   * Project file index (tree) for a directory on a remote device, via the
   * device's `getProjectFileIndex` RPC. Powers the Files tab's tree. Returns
   * `null` when offline.
   */
  getProjectFileIndex: deviceProcedure
    .input(z.object({ deviceId: z.string(), scope: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.getProjectFileIndex({
        deviceId: input.deviceId,
        scope: input.scope,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),
  /**
   * Children of one directory inside a project on a remote device. The Files
   * tree calls this when the user expands a directory the index collapsed
   * (a fully git-ignored folder). Returns `null` when offline.
   */
  listProjectDirectory: deviceProcedure
    .input(z.object({ deviceId: z.string(), relativePath: z.string(), root: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.listProjectDirectory({
        deviceId: input.deviceId,
        relativePath: input.relativePath,
        root: input.root,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),
  /**
   * Browse one directory level on a remote device. Personal devices belong to
   * the caller; workspace devices follow {@link assertDeviceOperable}.
   */
  browseDirectory: deviceProcedure
    .input(
      z.object({
        cursor: z.string().optional(),
        deviceId: z.string(),
        limit: z.number().int().positive().max(1000).optional(),
        path: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertDeviceOperable(ctx, input.deviceId, 'browse folders');

      const result = await deviceGateway.browseDirectory({
        cursor: input.cursor,
        deviceId: input.deviceId,
        limit: input.limit,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),
  /**
   * Create a folder inside the directory a remote folder picker is browsing, so
   * a new working directory can be made without leaving the picker. Same access
   * rule as {@link browseDirectory}; a taken name is reported as `CONFLICT`.
   */
  createDirectory: deviceProcedure
    .input(
      z.object({
        deviceId: z.string(),
        name: z.string().min(1).max(255),
        parentPath: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertDeviceOperable(ctx, input.deviceId, 'create folders');

      if (
        !isValidDirectoryName(input.name, input.parentPath) ||
        !isValidDirectoryName(input.name.trim(), input.parentPath)
      ) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid folder name.' });
      }

      let result: Awaited<ReturnType<typeof deviceGateway.createDirectory>>;
      try {
        result = await deviceGateway.createDirectory({
          deviceId: input.deviceId,
          name: input.name.trim(),
          parentPath: input.parentPath,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A device app predating `createLocalDirectory` needs an update, not a retry.
        throw new TRPCError({
          code: /Unknown device RPC method/.test(message) ? 'PRECONDITION_FAILED' : 'BAD_GATEWAY',
          message,
        });
      }

      if (!result.success) {
        throw new TRPCError({
          code: /already exists/i.test(result.error ?? '') ? 'CONFLICT' : 'BAD_REQUEST',
          message: result.error || 'Create folder failed',
        });
      }

      return result;
    }),
  /**
   * Search project files on a remote device. The device performs the match and
   * returns only the result subtree needed by the UI.
   */
  searchProjectFiles: deviceProcedure
    .input(
      z.object({
        changedOnly: z.boolean().optional(),
        deviceId: z.string(),
        excludeIgnored: z.boolean().optional(),
        limit: z.number().int().positive().max(500).optional(),
        query: z.string(),
        scope: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.searchProjectFiles({
        changedOnly: input.changedOnly,
        deviceId: input.deviceId,
        excludeIgnored: input.excludeIgnored,
        limit: input.limit,
        query: input.query,
        scope: input.scope,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),
  /**
   * Read-only local file preview for a file on a remote device. The web client
   * receives render data, not a `localfile://` URL; saving remains unsupported.
   */
  getLocalFilePreview: workspaceFileProcedure
    .input(
      z.object({
        accept: z.enum(['image']).optional(),
        path: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return deviceGateway.getLocalFilePreview({
        accept: input.accept,
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        workingDirectory: input.workingDirectory,
      });
    }),
  copyAssetForPublish: workspacePublishProcedure
    .input(z.object({ from: z.string(), to: z.string() }))
    .mutation(async ({ ctx, input }) =>
      deviceGateway.copyAssetForPublish({
        deviceId: input.deviceId,
        from: input.from,
        to: input.to,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        workingDirectory: input.workingDirectory,
      }),
    ),
  readExternalAssetForPublish: workspacePublishProcedure
    .input(z.object({ path: z.string() }))
    .query(async ({ ctx, input }) =>
      deviceGateway.readExternalAssetForPublish({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        workingDirectory: input.workingDirectory,
      }),
    ),
  /**
   * Project skills (`.agents/skills` / `.claude/skills`) for a directory on a
   * remote device, via the device's `listProjectSkills` RPC. Powers the
   * Resources tab's skills group in device mode. Returns `null` when offline.
   */
  listProjectSkills: deviceProcedure
    .input(z.object({ deviceId: z.string(), scope: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.listProjectSkills({
        deviceId: input.deviceId,
        scope: input.scope,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      // Register device-scoped skill roots (~/.agents/skills / ~/.claude/skills)
      // in an in-memory cache so subsequent getLocalFilePreview calls pass the
      // workspace root guard without polluting the UI's working-directory list.
      if (result?.skills) {
        const skillRoots = [
          ...new Set(result.skills.filter((s) => s.scope === 'device').map((s) => s.previewRoot)),
        ].filter(Boolean);
        registerDeviceSkillRoots(input.deviceId, skillRoots);
      }

      return result ?? null;
    }),
  /**
   * Claude Code's auto memory for a project on a remote device, via the
   * device's `listClaudeCodeMemory` RPC. Powers the workspace panel's Memory
   * tab in device mode; `agentId` applies that agent's own Claude Code config
   * dir. The project must be an approved root; the memory directory it maps to
   * is then approved for preview and save while the project stays approved.
   * Returns `null` when offline.
   */
  listClaudeCodeMemory: workspaceFileProcedure
    .input(z.object({ agentId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.listClaudeCodeMemory({
        deviceId: input.deviceId,
        env: input.agentId ? await resolveAgentClaudeMemoryEnv(ctx, input.agentId) : undefined,
        scope: input.workingDirectory,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      if (result?.memoryDir && result.files.length > 0) {
        registerDeviceMemoryRoot(input.deviceId, {
          memoryDir: result.memoryDir,
          projectRoot: input.workingDirectory,
        });
      }

      return result ?? null;
    }),
  /**
   * Move files/folders within a directory on a remote device, via the device's
   * `moveLocalFiles` RPC. Powers the Files tree's drag-to-move in device mode.
   */
  moveProjectFiles: workspaceFileWriteProcedure
    .input(
      z.object({
        items: z.array(z.object({ newPath: z.string(), oldPath: z.string() })),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return deviceGateway.moveProjectFiles({
        deviceId: input.deviceId,
        items: input.items,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        workingDirectory: input.workingDirectory,
      });
    }),
  /**
   * Rename a single file/folder in a directory on a remote device, via the
   * device's `renameLocalFile` RPC.
   */
  renameProjectFile: workspaceFileWriteProcedure
    .input(
      z.object({
        newName: z.string(),
        path: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return deviceGateway.renameProjectFile({
        deviceId: input.deviceId,
        newName: input.newName,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        workingDirectory: input.workingDirectory,
      });
    }),
  /**
   * Save edited content back to a file on a remote device, via the device's
   * `writeLocalFile` RPC. Powers remote save in the LocalFile editor.
   */
  writeProjectFile: workspaceFileWriteProcedure
    .input(
      z.object({
        content: z.string(),
        path: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return deviceGateway.writeProjectFile({
        content: input.content,
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        workingDirectory: input.workingDirectory,
      });
    }),
  /**
   * Create a new file on a remote device, via the device's `createLocalFile`
   * RPC. Fails instead of overwriting when the path is taken.
   */
  createProjectFile: workspaceFileWriteProcedure
    .input(
      z.object({
        content: z.string().optional(),
        path: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return deviceGateway.createProjectFile({
        content: input.content,
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        workingDirectory: input.workingDirectory,
      });
    }),
  /**
   * Create a new folder on a remote device, via the device's
   * `createLocalDirectory` RPC. Fails when the path is taken.
   */
  createProjectDirectory: workspaceFileWriteProcedure
    .input(z.object({ path: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return deviceGateway.createProjectDirectory({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        workingDirectory: input.workingDirectory,
      });
    }),
  /**
   * Copy files/folders on a remote device, via the device's `copyLocalFiles`
   * RPC. An item without `targetPath` is duplicated in place.
   */
  copyProjectFiles: workspaceFileWriteProcedure
    .input(
      z.object({
        items: z
          .array(z.object({ sourcePath: z.string(), targetPath: z.string().optional() }))
          .min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return deviceGateway.copyProjectFiles({
        deviceId: input.deviceId,
        items: input.items,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        workingDirectory: input.workingDirectory,
      });
    }),
  /**
   * Move files/folders to a remote device's trash, via the device's
   * `trashLocalFiles` RPC. Devices without a trash reject rather than delete.
   */
  trashProjectFiles: workspaceFileWriteProcedure
    .input(z.object({ paths: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      return deviceGateway.trashProjectFiles({
        deviceId: input.deviceId,
        paths: input.paths,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        workingDirectory: input.workingDirectory,
      });
    }),
  /**
   * Check whether a path exists on a remote device and is a directory, via the
   * device's `statPath` RPC. Lets a web client validate a manually-entered
   * working directory before binding it. Returns `null` when the device is
   * unreachable (caller treats "can't verify" as non-blocking).
   */
  statPath: deviceProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.statPath({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),
});
