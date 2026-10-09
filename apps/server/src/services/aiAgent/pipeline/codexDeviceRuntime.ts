import type { CodexBranchRun } from '@lobechat/heterogeneous-agents/protocol';

/** Device capability advertised by a CLI that can run `lh hetero exec --codex-app-server`. */
export const CODEX_APP_SERVER_RUNTIME = 'codex-app-server-v1';

/** How a connected device runs one Codex turn. */
export type CodexDeviceRuntime =
  /** Keep the existing `codex exec` path and its transcript recovery. */
  | { kind: 'exec' }
  /** The turn must not run; the caller settles it as a dispatch error. */
  | { kind: 'error'; message: string }
  | {
      /** Extra `lh hetero exec` wrapper flags. */
      args: string[];
      kind: 'native';
      /** Native thread to resume; for a first Fork, the source thread. */
      resumeSessionId?: string;
      /**
       * True for Fork branches: a missing native session fails instead of restarting
       * with a text transcript, which would silently replace the branch history.
       */
      strictHistory: boolean;
    };

export interface ResolveCodexDeviceRuntimeParams {
  /** `api` auth uses the hosted provider binding, which has no native app-server session. */
  authMode?: string;
  /** Present only when the run belongs to a Codex Fork thread. */
  forkThread?: unknown;
  heteroType: string;
  /** Reads the user's Labs `enableCodexAppServer` preference. */
  isAppServerLabEnabled: () => Promise<boolean>;
  /** Reads the live connection's advertised runtimes, never merged DB metadata. */
  querySupportedRuntimes: () => Promise<readonly string[] | undefined>;
  /** Resolves the Fork branch's native boundary or established child session. */
  resolveBranchRun: () => Promise<CodexBranchRun>;
  /** The topic-level (or Fork-thread-level) resume binding. */
  resumeSessionId?: string;
}

/**
 * Chooses between `codex exec` and the native app-server runtime for a device run.
 *
 * Use when:
 * - Dispatching a Codex turn to a connected device.
 * Expects:
 * - `forkThread` is set only for runs inside a Codex Fork thread.
 * Returns:
 * - `exec` for every ordinary run unless the user enabled the Labs app-server runtime and
 *   the device supports it; ordinary native runs keep transcript recovery.
 * - `native` with strict history for Fork branches.
 * - `error` when a Fork branch cannot run natively on this device.
 *
 * Call stack:
 *
 * dispatchHeteroAgent
 *   -> {@link resolveCodexDeviceRuntime}
 */
export const resolveCodexDeviceRuntime = async (
  params: ResolveCodexDeviceRuntimeParams,
): Promise<CodexDeviceRuntime> => {
  if (params.heteroType !== 'codex') return { kind: 'exec' };
  const nativeAuth = params.authMode !== 'api';

  if (!params.forkThread) {
    // Ordinary topics keep `codex exec` by default. The app-server runtime is opt-in through
    // the same Labs preference Desktop local runs use; it records the native turn IDs that
    // later make a message forkable.
    if (!nativeAuth || !(await params.isAppServerLabEnabled())) return { kind: 'exec' };
    const runtimes = await params.querySupportedRuntimes();
    if (!runtimes?.includes(CODEX_APP_SERVER_RUNTIME)) return { kind: 'exec' };
    return {
      args: ['--codex-app-server'],
      kind: 'native',
      resumeSessionId: params.resumeSessionId,
      strictHistory: false,
    };
  }

  const runtimes = nativeAuth ? await params.querySupportedRuntimes() : undefined;
  if (!runtimes?.includes(CODEX_APP_SERVER_RUNTIME)) {
    return {
      kind: 'error',
      message:
        'Native Codex Fork requires native authentication and a connected CLI supporting codex-app-server-v1. Update and reconnect that device.',
    };
  }
  const branchRun = await params.resolveBranchRun();
  if (branchRun.codexBranchError) return { kind: 'error', message: branchRun.codexBranchError };
  return {
    args: [
      '--codex-app-server',
      '--codex-strict-history',
      ...(branchRun.codexForkTarget
        ? ['--codex-fork-target', JSON.stringify(branchRun.codexForkTarget)]
        : []),
    ],
    kind: 'native',
    resumeSessionId: branchRun.resumeSessionId,
    strictHistory: true,
  };
};
