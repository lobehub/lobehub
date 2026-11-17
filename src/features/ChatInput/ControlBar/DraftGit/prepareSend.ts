import { generateWorktreeBranchName, WORKTREE_BRANCH_PREFIX } from '@lobechat/const';
import type { ConversationContext, WorkingDirConfig } from '@lobechat/types';
import { deriveWorktreePath } from '@lobechat/types';
import type { TFunction } from 'i18next';

import { deviceService } from '@/services/device';
import { gitService, isDeviceGitOutdated } from '@/services/git';
import { issueWorktreeReceipt } from '@/services/ownedWorktree';
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
      newTopicWorkingDirectory?: WorkingDirConfig;
      ok: true;
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

const createWorktree = async (
  target: DraftGitTarget,
  base: string | undefined,
  headBranch: string | undefined,
  { prompts, t }: { prompts: DraftGitSendPrompts; t: TFunction<'device'> },
): Promise<DraftGitSendResult> => {
  const fail = (description: string) => {
    prompts.notifyError({ description, title: t('workingDirectory.worktreeCreateFailed') });
    return STOP;
  };
  // Forking from HEAD needs nothing new from the device; only a different
  // start point does, so only then is it passed (and the device checked).
  const startPoint = base && base !== headBranch ? base : undefined;
  if (startPoint && !(await deviceHonoursBranch(target, startPoint)))
    return fail(t('workingDirectory.deviceOutdated'));

  const branch = generateWorktreeBranchName({ exclude: await listBranchNames(target) });
  // The creation receipt, signed by the server for this user: the device
  // writes it into the worktree, and only a cleanup presenting it — which the
  // server does only for this user's topics — may later remove the folder.
  const receipt = await issueWorktreeReceipt();
  const ownerToken = receipt?.token;
  const homeDir = target.deviceId
    ? undefined
    : desktopStateSelectors.userHomePath(getElectronStoreState()) || undefined;
  const dismiss = prompts.showProgress(t('workingDirectory.preparingWorktree'));
  try {
    const result = await gitService.addGitWorktree({
      branch,
      deviceId: target.deviceId,
      ownerToken,
      path: target.path,
      sourcePath: target.sourcePath,
      startPoint,
      stripBranchPrefix: true,
      // Local only: a remote device's folder is derived by the server.
      worktreePath: target.deviceId
        ? ''
        : deriveWorktreePath(target.sourcePath, branch, {
            homeDir,
            stripBranchPrefix: WORKTREE_BRANCH_PREFIX,
          }),
    });
    if (!result.success || !result.worktreePath)
      return fail(describeGitFailure(result, t, t('workingDirectory.worktreeCreateFailed')));

    return {
      acted: true,
      newTopicWorkingDirectory: {
        git: {
          activeWorktree: result.worktreePath,
          autoCreated: true,
          autoCreatedAt: new Date().toISOString(),
          // Only what the device confirms it recorded.
          ...(ownerToken &&
            result.ownerToken === ownerToken && { ownerNonce: receipt?.nonce, ownerToken }),
          branch,
          isWorktree: true,
          // The send created this branch: the run end may look its PR up.
          ownBranch: branch,
        },
        path: target.sourcePath,
        repoType: target.isGithub ? 'github' : 'git',
        sessionPath: result.worktreePath,
      },
      ok: true,
    };
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
 * The git half of a new topic's first send under Better Coding Experience,
 * run before the user message is saved. The picked branch is acted on now:
 *
 * - "New worktree" on: a new `lobehub/…` branch is cut from it into its own
 *   worktree, which becomes the new topic's directory; this directory is left
 *   alone, so there is nothing to warn about.
 * - Off: this directory switches to it — through a new branch when another
 *   worktree holds it — after warning about uncommitted changes and other
 *   topics running here.
 *
 * Any failure or cancellation returns `ok: false`: the caller does not send
 * and keeps the draft.
 */
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
  if (!picked && !worktreeMode) return PASS;

  // Act on what the directory is on now, not on the bar's last read.
  const head = await gitService
    .getGitBranch({ deviceId: target.deviceId, path: target.path })
    .catch(() => undefined);
  const headBranch = head?.detached ? undefined : head?.branch;

  const result = worktreeMode
    ? await createWorktree(target, picked ?? head?.branch, headBranch, { prompts, t })
    : picked && picked !== headBranch
      ? await switchInPlace(target, picked, { prompts, t })
      : PASS;

  // Done with: the pick now describes the directory (or its new worktree).
  if (result.ok) setDraftBranch(key, undefined);
  return result;
};
