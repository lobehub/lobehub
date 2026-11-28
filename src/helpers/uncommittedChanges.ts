import type {
  DeviceGitBranchInfo,
  DeviceGitWorkingTreeStatus,
  WorkingDirConfig,
} from '@lobechat/types';
import debug from 'debug';

const log = debug('lobe-hetero:uncommitted-changes');

/** How long a send waits for the working tree to be read; a slower answer gets no hint. */
export const UNCOMMITTED_PROBE_TIMEOUT_MS = 3000;

/** Someone's uncommitted work in the directory a heterogeneous run starts in. */
export interface UncommittedChanges {
  count: number;
  path: string;
}

/**
 * Whether a heterogeneous run should check its working directory for someone's
 * uncommitted work: a project conversation running outside any project folder
 * — on the agent's own device, in the agent's own working directory, which may
 * be a checkout the person is working in. Not when the run already works in a
 * worktree: one the first send created (DraftGit / `prepareSend`), or one
 * selected on the conversation. Callers check it once per CLI session — on a
 * fresh session, not a resumed one: the session keeps the hint, and the
 * changes a later turn finds are the agent's own.
 */
export const shouldCheckUncommittedChanges = ({
  cwdConfig,
  topic,
}: {
  cwdConfig: WorkingDirConfig | undefined;
  topic: { projectId?: string | null; projectWorkingDirectoryId?: string | null } | undefined;
}) =>
  !!topic?.projectId &&
  !topic.projectWorkingDirectoryId &&
  !!cwdConfig?.path &&
  !cwdConfig.git?.autoCreated &&
  !cwdConfig.git?.isWorktree &&
  !cwdConfig.git?.activeWorktree;

/**
 * The uncommitted changes of the git repository at `path`, read through `read`
 * (the device, or this desktop). `undefined` when it is not a repository, is
 * clean, or does not answer within {@link UNCOMMITTED_PROBE_TIMEOUT_MS} — the
 * run is then not held up and gets no hint.
 */
export const readUncommittedChanges = async (
  read: {
    branch: () => Promise<DeviceGitBranchInfo | undefined>;
    status: () => Promise<DeviceGitWorkingTreeStatus | undefined>;
  },
  path: string,
  timeoutMs = UNCOMMITTED_PROBE_TIMEOUT_MS,
): Promise<UncommittedChanges | undefined> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  try {
    const result = await Promise.race([Promise.all([read.branch(), read.status()]), timeout]);
    if (!result) {
      log('no answer within %dms for %s: no hint', timeoutMs, path);
      return;
    }
    const [branch, status] = result;
    // The working-tree read answers "clean" for a non-repository: the branch tells.
    if (!branch?.branch || !status || status.clean || status.total <= 0) {
      log('%s: %s', path, branch?.branch ? 'clean' : 'not a git repository');
      return;
    }
    log('%s: %d uncommitted changes, hinting a worktree', path, status.total);
    return { count: status.total, path };
  } catch (error) {
    log('read failed for %s: %O', path, error);
    return;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * What the agent is told about {@link UncommittedChanges}: work in a worktree
 * of its own, and leave the existing changes alone. Rides the turn's system
 * context — the text every CLI, Claude Code included, receives before the
 * prompt; the LobeHub plugin skill is a fixed file read on demand, so it cannot
 * carry a per-turn warning.
 */
export const formatUncommittedChangesContext = ({ count, path: rawPath }: UncommittedChanges) => {
  // A path is the person's own configuration, but it must not break the block.
  const path = `\`${rawPath.replaceAll(/[\n\r<>`]/g, '')}\``;
  return `<uncommitted_changes>\nThe working directory ${path} is a git repository with ${count} uncommitted change${count === 1 ? '' : 's'} that may be someone's work in progress. Before you change any file, create a separate worktree for this task (for example \`git worktree add ../<task-name> -b <task-branch>\`) and do all reading, editing and git work there. Leave the existing changes in ${path} untouched.\n</uncommitted_changes>`;
};
