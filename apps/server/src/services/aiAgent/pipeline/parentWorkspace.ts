import { generateWorktreeBranchName } from '@lobechat/const';
import type { ChatTopicMetadata, WorkingDirConfig } from '@lobechat/types';
import debug from 'debug';

import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { deviceGateway } from '@/server/services/deviceGateway';
import { issueWorktreeReceipt } from '@/server/services/worktreeCleanup/receipt';

import { resolveForegroundInterventionConfig } from '../foregroundIntervention';
import type { InternalExecAgentParams } from '../types';
import { createFirstSendWorktree } from './createFirstSendWorktree';
import { pickSandboxPlacement } from './sandboxPlacement';

const log = debug('lobe-server:ai-agent:parent-workspace');

/** A refusal the caller can act on (no repository on a device, a failed worktree). */
export class ParentWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParentWorkspaceError';
  }
}

/**
 * The parent's place to work, shared rather than owned: its device directory
 * (without the claims that make a cleanup or a PR lookup treat it as the
 * child's own) and its cloud-sandbox placement, so the child sees the same
 * files whichever side the parent runs on.
 */
export const inheritParentWorkingDirectory = (
  metadata: ChatTopicMetadata | null | undefined,
): Record<string, unknown> | undefined => {
  const config = metadata?.workingDirectoryConfig;
  const workingDirectory =
    metadata?.workingDirectory ?? config?.git?.activeWorktree ?? config?.path;
  const sandbox = pickSandboxPlacement(metadata ?? undefined);

  let shared: WorkingDirConfig | undefined;
  if (config) {
    shared = { ...config };
    if (config.git) {
      const git = { ...config.git };
      // The parent created that worktree / branch; the child must never clean
      // it up, and it is not the child's branch to find a PR for.
      delete git.autoCreated;
      delete git.autoCreatedAt;
      delete git.ownBranch;
      delete git.ownerNonce;
      delete git.ownerToken;
      shared.git = git;
    }
  }
  if (!workingDirectory && !shared && Object.keys(sandbox).length === 0) return;
  return {
    ...sandbox,
    ...(workingDirectory && { workingDirectory }),
    ...(shared && { workingDirectoryConfig: shared }),
  };
};

export interface PreparedParentWorkspace {
  params: InternalExecAgentParams;
  /**
   * Undo a worktree made for this run when no topic recorded it (the run was
   * refused first). Best effort; never throws.
   */
  rollback?: () => Promise<void>;
}

/**
 * Apply `parentWorkspace` to a run that opens a new topic from a parent: the
 * parent's device unless one is named, and its directory, a fresh worktree of
 * its repository, or nothing. Runs that continue a topic, or name no
 * workspace, pass through unchanged.
 */
export const prepareParentWorkspace = async (
  scope: { db: LobeChatDatabase; userId: string; workspaceId?: string },
  input: InternalExecAgentParams,
): Promise<PreparedParentWorkspace> => {
  let params = input;
  const { openedByTopicId, parentWorkspace } = params;
  if (!openedByTopicId || !parentWorkspace || params.appContext?.topicId) return { params };

  const topicModel = new TopicModel(scope.db, scope.userId, scope.workspaceId);
  const parent = await topicModel.findById(openedByTopicId);
  // An unknown parent records no link either (see `resolveTopicOpenedBy`).
  if (!parent) return { params };

  const metadata = parent.metadata as ChatTopicMetadata | null | undefined;
  // A sub-topic is a conversation the user follows: it asks for approvals the
  // way the user's own conversations do, unless the caller says otherwise.
  params = {
    ...params,
    userInterventionConfig:
      params.userInterventionConfig ??
      (await resolveForegroundInterventionConfig(scope.db, scope.userId)),
  };
  const initial = params.appContext?.initialTopicMetadata as Record<string, unknown> | undefined;

  // Opened from inside a run that may not use devices (an external bot
  // sender's sandbox): the child keeps that denial, so it never takes the
  // parent's device or a directory on it — only a cloud-sandbox placement.
  if (params.delegatedDeviceAccessDenied) {
    if (parentWorkspace === 'new-worktree') {
      throw new ParentWorkspaceError(
        'A new worktree is made on a device, and this conversation may not use devices. Use "inherit" or "none" instead.',
      );
    }
    const sandbox =
      parentWorkspace === 'inherit' ? pickSandboxPlacement(metadata ?? undefined) : {};
    const { deviceId: _dropped, ...rest } = params;
    return {
      params: {
        ...rest,
        ...(Object.keys(sandbox).length > 0 && {
          appContext: {
            ...params.appContext,
            initialTopicMetadata: { ...sandbox, ...initial } as any,
          },
        }),
      },
    };
  }

  // The parent's device unless the caller named one: a device-bound agent
  // (Claude Code) has nowhere else to run.
  const deviceId = params.deviceId ?? metadata?.boundDeviceId ?? undefined;

  if (parentWorkspace === 'none') {
    return { params: { ...params, ...(deviceId && { deviceId }) } };
  }

  if (parentWorkspace === 'inherit') {
    const inherited = inheritParentWorkingDirectory(metadata);
    return {
      params: {
        ...params,
        ...(deviceId && { deviceId }),
        ...(inherited && {
          appContext: {
            ...params.appContext,
            initialTopicMetadata: { ...inherited, ...initial } as any,
          },
        }),
      },
    };
  }

  // new-worktree: a fresh branch cut from the parent's repository, on its device.
  const config = metadata?.workingDirectoryConfig;
  const repoPath = config?.git?.activeWorktree ?? config?.path ?? metadata?.workingDirectory;
  if (!repoPath || !deviceId) {
    throw new ParentWorkspaceError(
      'A new worktree needs the parent conversation to work in a git repository on a connected device. Use "inherit" or "none" instead.',
    );
  }
  const branch = generateWorktreeBranchName();
  const sourcePath = config?.path ?? repoPath;
  const receipt = issueWorktreeReceipt(scope.userId);
  let created: WorkingDirConfig;
  try {
    created = await createFirstSendWorktree(
      {
        baseBranch: params.parentWorkspaceBaseBranch,
        branch,
        deviceId,
        ownerNonce: receipt?.nonce,
        ownerToken: receipt?.token,
        path: repoPath,
        repoType: config?.repoType === 'github' ? 'github' : 'git',
        sourcePath,
      } as any,
      { userId: scope.userId, workspaceId: scope.workspaceId },
    );
  } catch (error) {
    throw new ParentWorkspaceError(
      `Could not create the worktree: ${(error as Error)?.message || 'unknown error'}`,
    );
  }
  const worktreePath = created.git?.activeWorktree;

  const rollback = async () => {
    if (!worktreePath) return;
    try {
      // A topic that already points at it owns it now: its cleanup decides.
      if (
        (await topicModel.countLiveTopicsUsingWorktree({ excludeIds: [], path: worktreePath })) > 0
      )
        return;
      const device = {
        deviceId,
        path: repoPath,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
      };
      const removed = await deviceGateway.removeGitWorktree({ ...device, worktreePath });
      if (!removed.success) return;
      // The branch was cut for this run and never used: drop it with the folder.
      await deviceGateway.deleteGitBranch({ ...device, branch });
    } catch (error) {
      log('rolling back worktree %s failed: %O', worktreePath, error);
    }
  };

  return {
    params: {
      ...params,
      appContext: {
        ...params.appContext,
        initialTopicMetadata: {
          ...initial,
          workingDirectory: worktreePath,
          workingDirectoryConfig: created,
        } as any,
      },
      deviceId,
      // The worktree lives on this device: running anywhere else would use the
      // wrong filesystem, and cleanup would look for it on the wrong machine.
      requireDevice: true,
    },
    rollback,
  };
};
