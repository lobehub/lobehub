import { deriveWorktreePath } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import { deviceGateway } from '@/server/services/deviceGateway';

import { assertWorkspaceRootApproved } from '../deviceWorkspaceGuard';
import { assertDeviceOperable } from './guards';
import { deviceProcedure } from './procedures';

/**
 * A gateway read that resolved to `undefined` (gateway unconfigured, device
 * offline, RPC failed). Thrown rather than mapped to `[]` or `null`: `[]` is
 * indistinguishable from a real empty list, and released clients expect an
 * array, so only a procedure error keeps both old and new clients correct.
 */
const requireDeviceAnswer = <T>(result: T | undefined, what: string): T => {
  if (result === undefined)
    throw new TRPCError({ code: 'BAD_GATEWAY', message: `The device could not list ${what}.` });
  return result;
};

const gitPathInput = z.object({ deviceId: z.string(), path: z.string() });

/**
 * `deviceProcedure` that confines `input.path` to an approved workspace root —
 * the git mirror of `workspaceFileProcedure` in ./projectFiles. Every route
 * below asks the device to run `git` inside a caller-supplied directory, so
 * the root check is built into the procedure and can never be forgotten:
 * without it the directory came straight from an untrusted session and any
 * path on the device was fair game.
 */
const gitProcedure = deviceProcedure.input(gitPathInput).use(async (opts) => {
  const { deviceId, path } = gitPathInput.parse(await opts.getRawInput());
  await assertWorkspaceRootApproved(opts.ctx.deviceModel, deviceId, path, opts.ctx.workspaceId);
  return opts.next();
});

/**
 * `gitProcedure` for routes that change the repository (checkout, rename,
 * worktree add/remove, pull, push, revert, `gh pr` writes). Mutating the
 * working tree or refs is operating the machine, so the caller must also
 * satisfy {@link assertDeviceOperable} — a read-only viewer may read git
 * state inside an approved root but never modify it.
 */
const gitWriteProcedure = gitProcedure.use(async (opts) => {
  const { deviceId } = z.object({ deviceId: z.string() }).parse(await opts.getRawInput());
  await assertDeviceOperable(opts.ctx, deviceId, 'modify repositories on');
  return opts.next();
});

export const gitRouter = router({
  /**
   * Granular git reads for a directory on a remote device, each via its own
   * device RPC so the web/remote git status bar mirrors the local desktop's
   * separate, differently-cadenced SWR hooks. Return `null` when offline / the
   * directory isn't a git repo.
   */
  gitBranch: gitProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.gitBranch({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),
  gitLinkedPullRequest: gitProcedure
    .input(
      z.object({
        branch: z.string(),
        deviceId: z.string(),
        path: z.string(),
        pullRequestNumber: z.number().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.gitLinkedPullRequest({
        branch: input.branch,
        deviceId: input.deviceId,
        path: input.path,
        pullRequestNumber: input.pullRequestNumber,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),
  gitPullRequestDetail: gitProcedure
    .input(
      z.object({
        coreOnly: z.boolean().optional(),
        deviceId: z.string(),
        number: z.number().int().positive(),
        path: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.gitPullRequestDetail({
        coreOnly: input.coreOnly,
        deviceId: input.deviceId,
        number: input.number,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),
  gitPullRequestActivity: gitProcedure
    .input(
      z.object({ deviceId: z.string(), number: z.number().int().positive(), path: z.string() }),
    )
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.gitPullRequestActivity({
        deviceId: input.deviceId,
        number: input.number,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),
  gitPullRequestMergeContext: gitProcedure
    .input(
      z.object({
        baseRefName: z.string(),
        deviceId: z.string(),
        headRefOid: z.string().regex(/^[a-f\d]{40}$/i),
        number: z.number().int().positive(),
        path: z.string(),
        repo: z.object({ name: z.string(), owner: z.string() }),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.gitPullRequestMergeContext({
        ...input,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),
  gitWorkingTreeStatus: gitProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.gitWorkingTreeStatus({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),
  gitAheadBehind: gitProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.gitAheadBehind({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),
  /**
   * List the git worktrees attached to the same repository as a directory on a
   * remote device, via the device's `listGitWorktrees` RPC. Lets the web/remote
   * worktree picker mirror the local desktop's, populated over IPC.
   */
  listGitWorktrees: gitProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.listGitWorktrees({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? [];
    }),
  /**
   * List the local branches of a directory on a remote device, via the device's
   * `listGitBranches` RPC. Lets the web/remote branch switcher populate the same
   * dropdown the local desktop renders over IPC.
   */
  listGitBranches: gitProcedure
    .input(
      z.object({
        deviceId: z.string(),
        path: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.listGitBranches({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      // `[]` is a real answer (an unborn repo); a device that could not answer
      // is an error, never an empty list a client could cache over its copy.
      return requireDeviceAnswer(result, 'branches');
    }),
  /**
   * Checkout (or create) a branch in a directory on a remote device, via the
   * device's `checkoutGitBranch` RPC.
   */
  checkoutGitBranch: gitWriteProcedure
    .input(
      z.object({
        branch: z.string(),
        create: z.boolean().optional(),
        deviceId: z.string(),
        path: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      deviceGateway.checkoutGitBranch({
        branch: input.branch,
        create: input.create,
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      }),
    ),
  /**
   * Rename a branch in a directory on a remote device, via the device's
   * `renameGitBranch` RPC.
   */
  renameGitBranch: gitWriteProcedure
    .input(
      z.object({
        deviceId: z.string(),
        from: z.string(),
        path: z.string(),
        to: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      deviceGateway.renameGitBranch({
        deviceId: input.deviceId,
        from: input.from,
        path: input.path,
        to: input.to,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      }),
    ),
  /**
   * Delete a branch in a directory on a remote device, via the device's
   * `deleteGitBranch` RPC.
   */
  deleteGitBranch: gitWriteProcedure
    .input(
      z.object({
        branch: z.string(),
        deviceId: z.string(),
        path: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      deviceGateway.deleteGitBranch({
        branch: input.branch,
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      }),
    ),
  /**
   * Remove a worktree in a directory's repository on a remote device,
   * via the device's `removeGitWorktree` RPC.
   */
  removeGitWorktree: gitWriteProcedure
    .input(
      z.object({
        deviceId: z.string(),
        path: z.string(),
        worktreePath: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      deviceGateway.removeGitWorktree({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        worktreePath: input.worktreePath,
      }),
    ),
  /**
   * Add a linked worktree on a fresh branch in a directory's repository on a
   * remote device, via the device's `addGitWorktree` RPC.
   *
   * The target directory is derived here from the trusted `path` + `branch`
   * (a `<repo>-<branch>` sibling) rather than accepted from the request, so a
   * crafted web call can't ask the device to check out at an arbitrary absolute
   * path — the branch is folded to `-` in the folder name, so it can't traverse.
   */
  addGitWorktree: gitWriteProcedure
    .input(
      z.object({
        branch: z.string(),
        deviceId: z.string(),
        path: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      deviceGateway.addGitWorktree({
        branch: input.branch,
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        worktreePath: deriveWorktreePath(input.path, input.branch),
      }),
    ),
  /**
   * Pull (`--ff-only`) the current branch of a directory on a remote device, via
   * the device's `pullGitBranch` RPC.
   */
  pullGitBranch: gitWriteProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .mutation(async ({ ctx, input }) =>
      deviceGateway.pullGitBranch({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      }),
    ),
  /**
   * Push the current branch of a directory on a remote device, via the device's
   * `pushGitBranch` RPC.
   */
  pushGitBranch: gitWriteProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .mutation(async ({ ctx, input }) =>
      deviceGateway.pushGitBranch({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      }),
    ),
  /**
   * Run a `gh pr` mutation (merge, auto-merge, ready, comment, close, ...) on a
   * directory on a remote device, via the device's `runPullRequestAction` RPC.
   */
  runGitPullRequestAction: gitWriteProcedure
    .input(
      z.object({
        action: z.discriminatedUnion('type', [
          z.object({
            admin: z.boolean().optional(),
            deleteBranch: z.boolean().optional(),
            headRefOid: z.string().regex(/^[a-f\d]{40}$/i),
            method: z.enum(['squash', 'merge', 'rebase']),
            type: z.literal('merge'),
          }),
          z.object({
            headRefOid: z.string().regex(/^[a-f\d]{40}$/i),
            method: z.enum(['squash', 'merge', 'rebase']),
            type: z.literal('autoMerge'),
          }),
          z.object({ type: z.literal('disableAutoMerge') }),
          z.object({ method: z.enum(['merge', 'rebase']), type: z.literal('updateBranch') }),
          z.object({ type: z.literal('ready') }),
          z.object({ body: z.string(), type: z.literal('comment') }),
          z.object({ type: z.literal('close') }),
          z.object({ type: z.literal('reopen') }),
          z.object({ head: z.string(), type: z.literal('deleteBranch') }),
          z.object({ base: z.string(), type: z.literal('changeBase') }),
        ]),
        deviceId: z.string(),
        number: z.number().int().positive(),
        path: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      deviceGateway.runGitPullRequestAction({
        action: input.action,
        deviceId: input.deviceId,
        number: input.number,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      }),
    ),
  /**
   * Working-tree (unstaged) per-file patches for a directory on a remote device,
   * via the device's `getGitWorkingTreePatches` RPC. Powers the web/remote Review
   * panel's unstaged diff. Returns `null` when offline / not a git repo.
   */
  getGitWorkingTreePatches: gitProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.getGitWorkingTreePatches({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),
  /**
   * Branch diff (current branch vs base ref) per-file patches for a directory on
   * a remote device, via the device's `getGitBranchDiff` RPC.
   */
  getGitBranchDiff: gitProcedure
    .input(z.object({ baseRef: z.string().optional(), deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.getGitBranchDiff({
        baseRef: input.baseRef,
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),
  /**
   * List the remote branches of a directory on a remote device, via the device's
   * `listGitRemoteBranches` RPC. Populates the Review base-ref picker.
   */
  listGitRemoteBranches: gitProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.listGitRemoteBranches({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      // `[]` is a real answer (no `origin`); a device that could not answer is an error.
      return requireDeviceAnswer(result, 'remote branches');
    }),
  /**
   * Repo-relative paths of dirty working-tree files for a directory on a remote
   * device, via the device's `getGitWorkingTreeFiles` RPC. Powers the Files tab's
   * git-status overlay. Returns `null` when offline / not a git repo.
   */
  getGitWorkingTreeFiles: gitProcedure
    .input(z.object({ deviceId: z.string(), path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.getGitWorkingTreeFiles({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),
  /**
   * Revert a single file in a directory on a remote device, via the device's
   * `revertGitFile` RPC.
   */
  revertGitFile: gitWriteProcedure
    .input(z.object({ deviceId: z.string(), filePath: z.string(), path: z.string() }))
    .mutation(async ({ ctx, input }) =>
      deviceGateway.revertGitFile({
        deviceId: input.deviceId,
        filePath: input.filePath,
        path: input.path,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      }),
    ),
});
