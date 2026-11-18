import { generateWorktreeBranchName, isDesktop, WORKTREE_BRANCH_PREFIX } from '@lobechat/const';
import type { ConversationContext, FirstSendWorktree, WorkingDirConfig } from '@lobechat/types';
import { deriveWorktreePath } from '@lobechat/types';
import type { TFunction } from 'i18next';

import { deviceService } from '@/services/device';
import { gitService, isDeviceGitOutdated } from '@/services/git';
import { issueWorktreeReceipt } from '@/services/ownedWorktree';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { parseSingleAgentMentionDirectRoute } from '@/store/chat/slices/agentRun/actions/entries/commandBus/parseCommands';
import { gitStatusKey } from '@/store/device/gitStatus/projection';
import { getGitStatusStoreState } from '@/store/device/gitStatus/store';
import { getElectronStoreState } from '@/store/electron';
import { desktopStateSelectors } from '@/store/electron/selectors';
import { getUserStoreState } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { findWorktreeForBranch, getPathName } from '../worktreeHelpers';
import {
  draftBranchKey,
  type DraftGitTarget,
  getDraftBranch,
  getDraftGitTarget,
  setDraftBranch,
} from './draftGitStore';
import { describeGitFailure } from './gitErrors';
import { isWorktreeModeOn, worktreeModeKeyOf } from './useWorktreeMode';

/** The questions the send may have to ask, injected so the flow stays testable. */
export interface DraftGitSendPrompts {
  /** Name the branch cut from one another worktree holds; `undefined` cancels. */
  askBranchName: (params: {
    branch: string;
    defaultName: string;
    holder: string;
  }) => Promise<string | undefined>;
  /** Confirm a switch that may cost uncommitted work or disturb running topics. */
  confirmSwitchRisks: (params: {
    branch: string;
    running: number;
    uncommitted: number;
  }) => Promise<boolean>;
  notifyError: (params: { description: string; title: string }) => void;
  /** Show that the send is waiting on git; returns the dismiss callback. */
  showProgress: (label: string) => () => void;
}

export type DraftGitSendResult =
  | { ok: false }
  | {
      /**
       * Git was actually run (a switch or a new worktree), so the send waited
       * on it: the composer may have changed hands in the meantime.
       */
      acted?: boolean;
      firstSendWorktree?: FirstSendWorktree;
      newTopicWorkingDirectory?: WorkingDirConfig;
      ok: true;
      onMessagePersisted?: () => void;
    };

const PASS: DraftGitSendResult = { ok: true };
const STOP: DraftGitSendResult = { ok: false };

/**
 * The directory the send acts on, when it should act at all: the lab is on and
 * the send starts a new topic in an agent's composer that shows a git directory.
 */
export const resolveDraftGitTarget = (
  context: Pick<ConversationContext, 'agentId' | 'groupId' | 'threadId' | 'topicId'>,
  editorData?: Record<string, any>,
): DraftGitTarget | undefined => {
  if (!labPreferSelectors.enableBetterCodingExperience(getUserStoreState())) return;
  if (context.topicId || context.groupId || context.threadId || !context.agentId) return;
  // A message that starts with a single `@Agent` runs that agent, on its own
  // device and directory: the composer's directory is not where it runs.
  const route = parseSingleAgentMentionDirectRoute(editorData);
  if (route && route.agent.id !== context.agentId) return;
  return getDraftGitTarget(context.agentId);
};

/**
 * Whether the device honours a start point other than HEAD. Device RPCs have
 * no version negotiation and an older device forks from HEAD regardless, so
 * ask before mutating: a named-branch ahead/behind read echoes the branch only
 * on a device new enough for both. The composer usually has that read cached.
 */
const deviceHonoursBranch = async (target: DraftGitTarget, branch: string): Promise<boolean> => {
  const { deviceId, path } = target;
  const cached =
    getGitStatusStoreState().gitAheadBehindMap[gitStatusKey({ branch, deviceId, path })];
  if (cached?.value?.branch === branch) return true;
  try {
    await gitService.getGitAheadBehind({ branch, deviceId, path });
    return true;
  } catch (error) {
    if (isDeviceGitOutdated(error)) return false;
    // Any other failure is the write's to report, with git's own message.
    return true;
  }
};

const listBranchNames = async ({ deviceId, path }: DraftGitTarget): Promise<string[]> => {
  try {
    return (await gitService.listGitBranches({ deviceId, path })).map((branch) => branch.name);
  } catch {
    // A colliding name is refused by git at create time; the draw just can't avoid it.
    return [];
  }
};

const countRunningTopics = async ({ keyDeviceId, path }: DraftGitTarget): Promise<number> => {
  if (!keyDeviceId) return 0;
  try {
    return await deviceService.countRunningTopicsInDirectory(keyDeviceId, path);
  } catch (error) {
    // A soft warning only: failing to count must not block the send.
    console.warn('[prepareDraftGitSend] could not count running topics', error);
    return 0;
  }
};

const snapshotWorktree = (
  target: DraftGitTarget,
  baseBranch: string | undefined,
  { prompts, t }: { prompts: DraftGitSendPrompts; t: TFunction<'device'> },
): DraftGitSendResult => {
  const deviceId = target.deviceId ?? target.keyDeviceId;
  if (!deviceId) {
    prompts.notifyError({
      description: t('workingDirectory.worktreeDeviceRequired'),
      title: t('workingDirectory.worktreeCreateFailed'),
    });
    return STOP;
  }
  const key = draftBranchKey(target);
  return {
    firstSendWorktree: {
      baseBranch,
      deviceId,
      path: target.path,
      repoType: target.isGithub ? 'github' : 'git',
      sourcePath: target.sourcePath,
    },
    ok: true,
    onMessagePersisted: () => {
      if (getDraftBranch(key) === baseBranch) setDraftBranch(key, undefined);
    },
  };
};

/** API-bound agents must run in this Desktop, even without a gateway registration. */
const createLocalWorktree = async (
  target: DraftGitTarget,
  picked: string | undefined,
  { prompts, t }: { prompts: DraftGitSendPrompts; t: TFunction<'device'> },
): Promise<DraftGitSendResult> => {
  const { path, sourcePath } = target;
  const title = t('workingDirectory.worktreeCreateFailed');
  const fail = (description: string) => {
    prompts.notifyError({ description, title });
    return STOP;
  };
  const dismiss = prompts.showProgress(t('workingDirectory.preparingWorktree'));
  try {
    const [refs, receipt] = await Promise.all([listBranchNames(target), issueWorktreeReceipt()]);
    const branch = generateWorktreeBranchName({ exclude: refs });
    const homeDir = desktopStateSelectors.userHomePath(getElectronStoreState()) || undefined;
    const ownerToken = receipt?.token;
    const result = await gitService.addGitWorktree({
      branch,
      ownerToken,
      path,
      startPoint: picked,
      worktreePath: deriveWorktreePath(sourcePath, branch, {
        homeDir,
        stripBranchPrefix: WORKTREE_BRANCH_PREFIX,
      }),
    });
    if (!result.success || !result.worktreePath) return fail(describeGitFailure(result, t, title));

    return {
      acted: true,
      newTopicWorkingDirectory: {
        git: {
          activeWorktree: result.worktreePath,
          autoCreated: true,
          autoCreatedAt: new Date().toISOString(),
          branch,
          isWorktree: true,
          ownBranch: branch,
          ...(ownerToken &&
            result.ownerToken === ownerToken && { ownerNonce: receipt?.nonce, ownerToken }),
        },
        path: sourcePath,
        repoType: target.isGithub ? 'github' : 'git',
        sessionPath: result.worktreePath,
      },
      ok: true,
    };
  } catch (error) {
    console.error('[prepareDraftGitSend] could not create Desktop worktree', error);
    return fail(isDeviceGitOutdated(error) ? t('workingDirectory.deviceOutdated') : title);
  } finally {
    dismiss();
  }
};

const switchInPlace = async (
  target: DraftGitTarget,
  picked: string,
  { prompts, t }: { prompts: DraftGitSendPrompts; t: TFunction<'device'> },
): Promise<DraftGitSendResult> => {
  const { deviceId, path } = target;
  const title = t('workingDirectory.switchFailed', { branch: picked });
  const fail = (description: string) => {
    prompts.notifyError({ description, title });
    return STOP;
  };

  // Git checks a branch out in one worktree at most. One held elsewhere is cut
  // into a new branch here instead, named by the user.
  const worktrees = await gitService.listGitWorktrees({ deviceId, path }).catch(() => []);
  const holder = findWorktreeForBranch(worktrees, picked);
  let checkout: { branch: string; create?: boolean; startPoint?: string } = { branch: picked };
  if (holder) {
    const name = await prompts.askBranchName({
      branch: picked,
      defaultName: generateWorktreeBranchName({ exclude: await listBranchNames(target) }),
      holder: getPathName(holder.path),
    });
    if (!name) return STOP;
    if (!(await deviceHonoursBranch(target, picked)))
      return fail(t('workingDirectory.deviceOutdated'));
    checkout = { branch: name, create: true, startPoint: picked };
  }

  const [status, running] = await Promise.all([
    gitService.getGitWorkingTreeStatus({ deviceId, path }).catch(() => undefined),
    countRunningTopics(target),
  ]);
  const uncommitted = status && !status.clean ? status.total : 0;
  if (
    (uncommitted > 0 || running > 0) &&
    !(await prompts.confirmSwitchRisks({ branch: checkout.branch, running, uncommitted }))
  )
    return STOP;

  const dismiss = prompts.showProgress(
    t('workingDirectory.preparingSwitch', { branch: checkout.branch }),
  );
  try {
    // Git's own rules: no stash, no force. Uncommitted changes travel with the
    // checkout, and a conflicting one makes git refuse — shown as is.
    const result = await gitService.checkoutGitBranch({ deviceId, path, ...checkout });
    if (!result.success)
      return fail(describeGitFailure(result, t, t('workingDirectory.checkoutFailed')));
  } finally {
    dismiss();
  }
  await getGitStatusStoreState().revalidateGitStatus(deviceId, path);
  return { acted: true, ok: true };
};

/**
 * What the send will act on, read from the composer at the moment the user
 * sends. A send that runs later (a voice turn, after upload and transcription)
 * takes this snapshot along: by then the composer may show another
 * conversation and have dropped this directory's registration.
 */
export interface DraftGitSnapshot {
  picked?: string;
  target: DraftGitTarget;
  worktreeMode: boolean;
}

export const snapshotDraftGit = (
  context: Pick<ConversationContext, 'agentId' | 'groupId' | 'threadId' | 'topicId'>,
  editorData?: Record<string, any>,
): DraftGitSnapshot | undefined => {
  const target = resolveDraftGitTarget(context, editorData);
  if (!target) return;
  return {
    picked: getDraftBranch(draftBranchKey(target)),
    target,
    worktreeMode: isWorktreeModeOn(worktreeModeKeyOf(target.keyDeviceId, target.path)),
  };
};

/**
 * Whether the snapshot asks the send to run git (switch to a picked branch, or
 * fork a worktree). A deferred send ("Send later") cannot: the scheduled run
 * creates its topic server-side, long after the composer, from the agent's
 * defaults — so the composer refuses to schedule instead of dropping the choice.
 */
export const needsSendTimeGit = (snapshot: DraftGitSnapshot | undefined): boolean =>
  !!snapshot && (!!snapshot.picked || snapshot.worktreeMode);

export const prepareDraftGitSend = async (
  context: Pick<ConversationContext, 'agentId' | 'groupId' | 'threadId' | 'topicId'>,
  {
    editorData,
    prompts,
    snapshot,
    t,
  }: {
    editorData?: Record<string, any>;
    prompts: DraftGitSendPrompts;
    /** Taken when the user sent; read from the composer now when absent. */
    snapshot?: DraftGitSnapshot;
    t: TFunction<'device'>;
  },
): Promise<DraftGitSendResult> => {
  const snap = snapshot ?? snapshotDraftGit(context, editorData);
  if (!snap) return PASS;
  const { picked, target, worktreeMode } = snap;
  const key = draftBranchKey(target);
  if (worktreeMode) {
    const provider =
      isDesktop && !target.deviceId
        ? agentSelectors.getAgentConfigById(target.agentId)(getAgentStoreState())?.agencyConfig
            ?.heterogeneousProvider
        : undefined;
    if (provider?.authMode !== 'api') return snapshotWorktree(target, picked, { prompts, t });

    const result = await createLocalWorktree(target, picked, { prompts, t });
    if (result.ok && getDraftBranch(key) === picked) setDraftBranch(key, undefined);
    return result;
  }
  if (!picked) return PASS;

  // Act on what the directory is on now, not on the bar's last read.
  const head = await gitService
    .getGitBranch({ deviceId: target.deviceId, path: target.path })
    .catch(() => undefined);
  const headBranch = head?.detached ? undefined : head?.branch;

  const result = picked !== headBranch ? await switchInPlace(target, picked, { prompts, t }) : PASS;

  // Done with: the pick now describes the directory (or its new worktree).
  if (result.ok) setDraftBranch(key, undefined);
  return result;
};
