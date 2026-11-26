import { normalizeDirectoryPath } from '@lobechat/types';
import { createWithEqualityFn } from 'zustand/traditional';

/**
 * The git directory a new topic's composer shows, as the send needs it.
 * Registered by the control bar that renders it, so the send acts on exactly
 * the directory the user sees — never a re-derivation that could disagree.
 */
export interface DraftGitTarget {
  agentId: string;
  /** Remote device for RPC; `undefined` is this machine over Electron IPC. */
  deviceId?: string;
  isGithub: boolean;
  /**
   * The real device id, also for this machine (its gateway device id). Keys
   * the worktree switch and matches other topics' `boundDeviceId`; undefined
   * only on a desktop that never registered with the gateway.
   */
  keyDeviceId?: string;
  /** The directory git runs in (the effective one, a worktree included). */
  path: string;
  /** The repository's main checkout; worktrees are recorded against it. */
  sourcePath: string;
}

/**
 * Before the first send, picking a branch only records it: the checkout or worktree happens when the message is sent. The
 * pick lives here, per agent + device + directory, so it survives the switcher
 * closing but not a reload — it is a draft, never persisted.
 */
interface DraftGitState {
  /** `draftBranchKey` → the branch picked for the next send. */
  selections: Record<string, string>;
  /** agentId → the directory its new-topic composer currently shows. */
  targets: Record<string, DraftGitTarget>;
}

export const useDraftGitStore = createWithEqualityFn<DraftGitState>()(() => ({
  selections: {},
  targets: {},
}));

export const draftBranchKey = ({
  agentId,
  keyDeviceId,
  path,
}: Pick<DraftGitTarget, 'agentId' | 'keyDeviceId' | 'path'>) =>
  `${agentId}\u0000${keyDeviceId ?? 'local'}\u0000${normalizeDirectoryPath(path)}`;

export const setDraftBranch = (key: string, branch: string | undefined) =>
  useDraftGitStore.setState((state) => {
    const selections = { ...state.selections };
    if (branch) selections[key] = branch;
    else delete selections[key];
    return { selections };
  });

export const getDraftBranch = (key: string): string | undefined =>
  useDraftGitStore.getState().selections[key];

export const registerDraftGitTarget = (target: DraftGitTarget) =>
  useDraftGitStore.setState((state) => ({
    targets: { ...state.targets, [target.agentId]: target },
  }));

/** Drop the registration, unless another bar has since replaced it. */
export const unregisterDraftGitTarget = (target: DraftGitTarget) =>
  useDraftGitStore.setState((state) => {
    if (state.targets[target.agentId] !== target) return state;
    const targets = { ...state.targets };
    delete targets[target.agentId];
    return { targets };
  });

export const getDraftGitTarget = (agentId: string): DraftGitTarget | undefined =>
  useDraftGitStore.getState().targets[agentId];
