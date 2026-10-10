import type { WorkingDirConfig, WorkingDirEntry } from '@lobechat/types';
import { getWorkingDirEffectivePath, getWorkingDirSourcePath } from '@lobechat/types';
import { confirmModal } from '@lobehub/ui/base-ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { getHeteroSessionIdForWorkingDirectory } from '@/helpers/heteroSessionByWorkingDirectory';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';

export interface CommitWorkingDirectoryOptions {
  /**
   * Persist against the `local` execution target on this machine, regardless of
   * what the agent's config currently says. For callers that select the local
   * target as part of the same action — the resolved config still describes the
   * previous target at that point, and selecting first does not re-render in
   * time to help.
   */
  localTarget?: boolean;
}

export interface CommitAgentDefaultOptions {
  /**
   * Reject when persisting the shared agent config fails. The store otherwise
   * swallows the error (and rolls the optimistic value back), so a caller that
   * acts on the saved directory right after — e.g. switching to a fresh topic —
   * must opt in to learn the write never landed.
   */
  rethrow?: boolean;
  /** Keep the store's generic save-failure toast. @default true */
  showErrorMessage?: boolean;
}

const normalizeWorkingDirEntry = (entry: WorkingDirEntry): WorkingDirEntry | undefined => {
  const path = entry.path.trim();
  if (!path) return undefined;

  const activeWorktree = entry.git?.activeWorktree?.trim();
  const branch = entry.git?.branch?.trim();
  const next: WorkingDirEntry = { ...entry, path };

  if (entry.git) {
    const git = { ...entry.git };
    if (activeWorktree) git.activeWorktree = activeWorktree;
    else delete git.activeWorktree;

    if (branch) git.branch = branch;
    else delete git.branch;

    if (Object.keys(git).length > 0) next.git = git;
    else delete next.git;
  }

  return next;
};

const toAgentWorkingDirConfig = (entry: WorkingDirEntry): WorkingDirConfig => ({
  ...(entry.git ? { git: entry.git } : {}),
  path: entry.path,
  ...(entry.repoType ? { repoType: entry.repoType } : {}),
});

/**
 * Unified working-directory writes, shared by the directory picker for both
 * local and remote runs.
 *
 * **Set** rules:
 * - **active topic**     → `topic.metadata.workingDirectory` (per-topic override)
 * - **no topic yet**     → `agencyConfig.workingDirByDevice[targetDeviceId]`
 * - **always**           → upsert the target device's `workingDirs` recent list
 *
 * **Clear** cascades to whichever precedence level currently supplies the cwd
 * (topic override first, then the agent-level default), instead of only the
 * active topic. Built-in agents never bake the cwd into the topic the way the
 * hetero flow does (see `conversationLifecycle` newTopic metadata), so a
 * topic-only clear would leave the agent-level value re-supplying the directory
 * and Clear would look dead.
 *
 * Changing a topic's cwd invalidates its pinned CC session (sessions are keyed
 * per-cwd), so warn before the reset and clear the stale session id as part of
 * the same metadata write — same as the legacy pickers.
 */
export const useCommitWorkingDirectory = (agentId: string, routeTopicId?: string | null) => {
  const { t } = useTranslation(['plugin', 'chat', 'project']);

  // The RAW shared config identifies agent-owned state. Directory writes patch
  // only their target device, never the member's effective device override.
  const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  // The EFFECTIVE config (override merged) — only for resolving
  // which device the cwd write should target, keeping it on the same machine
  // the picker/GitStatus/`useEffectiveWorkingDirectory` operate on.
  const {
    agencyConfig: effectiveAgencyConfig,
    isPreferenceLoading,
    workspaceScoped,
  } = useEffectiveAgencyConfig(agentId, { topicId: routeTopicId });
  // Heterogeneous CLI agents (Claude Code, Codex, …) key their sessions to the
  // cwd they run in, so the pinned cwd and the CLI session always name the same
  // directory — the effective one (worktree included). See `writeCwd`.
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const updateAgentRuntimeEnvConfigById = useAgentStore((s) => s.updateAgentRuntimeEnvConfigById);
  const legacyAgentWorkingDirectory = useAgentStore(
    (s) => s.localAgentWorkingDirectoryMap[agentId],
  );

  const globalActiveTopicId = useChatStore((s) => s.activeTopicId);
  const activeTopicId = routeTopicId === undefined ? globalActiveTopicId : routeTopicId;
  const activeTopic = useChatStore((s) =>
    activeTopicId ? topicSelectors.getTopicById(activeTopicId)(s) : undefined,
  );
  const updateTopicMetadata = useChatStore((s) => s.updateTopicMetadata);

  const updateDeviceCwd = useDeviceStore((s) => s.updateDeviceCwd);
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const targetDeviceId = resolveTargetDeviceId(effectiveAgencyConfig, currentDeviceId, {
    workspaceScoped,
  });

  // A workspace agent resolving to THIS member's personal machine (a `local`
  // override) must not persist its cwd into the workspace-shared
  // `agents.agencyConfig.workingDirByDevice` — that would leak the member's
  // personal device id and an absolute local path to every other member. Route
  // those writes to the per-user legacy slot instead (a `local` pick only
  // exists on desktop, where that slot works). Workspace-pool devices keep the
  // shared per-device map: the path lives on a machine the workspace shares.
  const isWorkspaceAgent = useAgentStore((s) => Boolean(s.agentMap[agentId]?.workspaceId));
  // A `local` target always denotes the member's own machine — its
  // `boundDeviceId` is that machine's personal gateway id even when viewed
  // from web (`currentDeviceId` undefined there, so an id-equality check alone
  // would miss it). The equality arm still covers a desktop default target
  // (no stored target → `resolveTargetDeviceId` falls back to this machine).
  const isPersonalDeviceTarget =
    isWorkspaceAgent &&
    !workspaceScoped &&
    !!targetDeviceId &&
    (effectiveAgencyConfig?.executionTarget === 'local' || targetDeviceId === currentDeviceId);

  const writeCwd = useCallback(
    async (entry?: WorkingDirEntry, options?: CommitWorkingDirectoryOptions) => {
      // A caller that is *about to* select the local target cannot rely on the
      // resolved config yet: this callback closes over the config as it is now,
      // and selecting first would not re-render in time either. `localTarget`
      // lets it state the destination it is creating, so the cwd lands in the
      // same slot the pending `local` pick will read from.
      const localTarget = options?.localTarget === true;
      const writeDeviceId = localTarget ? currentDeviceId : targetDeviceId;
      // A `local` pick on a workspace agent always means this member's own
      // machine, which routes to the per-user slot rather than the shared row.
      const writePersonalSlot = localTarget
        ? isWorkspaceAgent && !!currentDeviceId
        : isPersonalDeviceTarget;
      const effectivePath = getWorkingDirEffectivePath(entry);
      // The run cwd IS the session cwd for every agent type: the CLI spawns in
      // the effective path (the selected worktree when there is one) and the
      // topic pins that same path, so every later turn resolves it identically.
      // `heteroSessionIdByWorkingDirectory` carries one CLI session per cwd, so
      // moving between worktrees restores each one's own context rather than
      // dropping it — no reason to anchor the run to the source repo.
      // Topic override wins once a conversation exists; otherwise persist the
      // agent's per-device choice so a new topic inherits it.
      if (activeTopicId) {
        // The path the topic currently pins — the same one `workingDirectory`
        // above resolves for a run, so the two can't disagree about the cwd.
        const priorSessionCwd = activeTopic?.metadata?.workingDirectory;
        const scopedHeteroSessionId = getHeteroSessionIdForWorkingDirectory(
          activeTopic?.metadata,
          effectivePath,
        );
        // A cwd change invalidates the session pinned to the OLD path; the new
        // path's own scoped session (if any) takes over in the same write.
        const shouldUpdateHeteroSession =
          priorSessionCwd !== effectivePath &&
          (!!activeTopic?.metadata?.heteroSessionId || !!scopedHeteroSessionId);
        await updateTopicMetadata(activeTopicId, {
          // The pin is a bare path that only holds on the machine it was picked
          // for, and the server skips a topic pin whose `boundDeviceId` names a
          // different device. Re-stamp it with every write so a conversation
          // moved to another device keeps the directory just chosen there.
          boundDeviceId: entry ? writeDeviceId : undefined,
          ...(shouldUpdateHeteroSession ? { heteroSessionId: scopedHeteroSessionId } : {}),
          workingDirectory: effectivePath,
          workingDirectoryConfig: entry ? toAgentWorkingDirConfig(entry) : undefined,
        });
      } else {
        if (writeDeviceId && writePersonalSlot) {
          // Per-user slot (see `isPersonalDeviceTarget`) — never the shared row.
          // The legacy slot stores a plain path, so persist the same effective
          // cwd the picker would pin on a topic (worktree included) — anything
          // else would spawn the next run somewhere the user did not pick. The
          // worktree pick itself is carried by topic metadata once a
          // conversation starts; full-fidelity pre-topic persistence needs a
          // per-user server-side slot (deferred).
          await updateAgentRuntimeEnvConfigById(agentId, {
            workingDirectory: effectivePath || undefined,
          });
        } else if (writeDeviceId) {
          await updateAgentConfigById(
            agentId,
            {
              agencyConfig: {
                workingDirByDevice: {
                  [writeDeviceId]: entry ? toAgentWorkingDirConfig(entry) : undefined,
                },
              },
            },
            { replaceWorkingDirDeviceIds: [writeDeviceId] },
          );
        }
        // Clearing the agent default must also drop the legacy per-agent value —
        // otherwise it keeps re-supplying a stale cwd from a lower precedence
        // level and Clear looks dead. (Only clears the localStorage map; no
        // network round-trip since `workingDirectory` is stripped before send.)
        // The personal-device branch above already wrote that same slot.
        if (!writePersonalSlot && !effectivePath && legacyAgentWorkingDirectory) {
          await updateAgentRuntimeEnvConfigById(agentId, { workingDirectory: undefined });
        }
      }
      // Record on the target device's recent list (not the device-wide default —
      // a per-agent pick shouldn't repoint other agents on the same device).
      if (entry && effectivePath && targetDeviceId) {
        await updateDeviceCwd(targetDeviceId, entry, { setDefault: false });
      }
    },
    [
      agentId,
      activeTopic,
      activeTopicId,
      currentDeviceId,
      isPersonalDeviceTarget,
      targetDeviceId,
      legacyAgentWorkingDirectory,
      updateAgentConfigById,
      updateAgentRuntimeEnvConfigById,
      updateTopicMetadata,
      updateDeviceCwd,
    ],
  );

  // Clear whichever precedence level currently supplies the cwd, so the picker
  // falls back to the next level (agent default → device default → "not set").
  const clearCwd = useCallback(async () => {
    if (activeTopic?.projectWorkingDirectoryId)
      throw new Error(t('directories.boundRoot', { ns: 'project' }));
    // A topic override (when present) is the effective source — drop it first so
    // we fall back to the agent default rather than nuking everything.
    if (activeTopicId && activeTopic?.metadata?.workingDirectory) {
      await updateTopicMetadata(activeTopicId, {
        // No pin left, so no device it belongs to — the next run stamps its own.
        boundDeviceId: undefined,
        ...(activeTopic.metadata.heteroSessionId ? { heteroSessionId: undefined } : {}),
        workingDirectory: undefined,
        workingDirectoryConfig: undefined,
      });
      return;
    }
    // No topic override: clear the agent-level default(s). An explicit
    // `undefined` entry carries deletion through the client and server. The user
    // can't tell the
    // per-device map from the legacy slot, so clear both together to avoid a
    // dead second click.
    if (targetDeviceId && agencyConfig?.workingDirByDevice?.[targetDeviceId]) {
      await updateAgentConfigById(
        agentId,
        { agencyConfig: { workingDirByDevice: { [targetDeviceId]: undefined } } },
        { replaceWorkingDirDeviceIds: [targetDeviceId] },
      );
    }
    // (Only clears the localStorage map; no network round-trip since
    // `workingDirectory` is stripped before send.)
    if (legacyAgentWorkingDirectory) {
      await updateAgentRuntimeEnvConfigById(agentId, { workingDirectory: undefined });
    }
  }, [
    agentId,
    agencyConfig,
    activeTopic,
    activeTopicId,
    targetDeviceId,
    legacyAgentWorkingDirectory,
    updateAgentConfigById,
    updateAgentRuntimeEnvConfigById,
    updateTopicMetadata,
    t,
  ]);

  /** Pick a directory (with the CC-session-reset guard). */
  const commit = useCallback(
    async (entry: WorkingDirEntry, options?: CommitWorkingDirectoryOptions) => {
      const normalizedEntry = normalizeWorkingDirEntry(entry);
      const effectivePath = getWorkingDirEffectivePath(normalizedEntry);
      if (!normalizedEntry || !effectivePath) return;

      if (activeTopic?.projectWorkingDirectoryId) {
        const source = getWorkingDirSourcePath(
          activeTopic.metadata?.workingDirectoryConfig ?? activeTopic.metadata?.workingDirectory,
        );
        if (getWorkingDirSourcePath(normalizedEntry) !== source)
          throw new Error(t('directories.boundRoot', { ns: 'project' }));
      }
      const run = () => writeCwd(normalizedEntry, options);

      // Warn before a switch that starts a FRESH CLI session. Sessions are keyed
      // to the cwd they ran in, so moving to a directory with no session of its
      // own leaves the next message without the previous context. Moving to a
      // directory that already has one is a context switch, not a reset — the
      // topic keeps whichever session belongs to each cwd — so it stays silent.
      const priorSessionId = activeTopic?.metadata?.heteroSessionId;
      const priorSessionCwd = activeTopic?.metadata?.workingDirectory;
      const targetSessionId = getHeteroSessionIdForWorkingDirectory(
        activeTopic?.metadata,
        effectivePath,
      );
      if (
        priorSessionId &&
        priorSessionCwd &&
        priorSessionCwd !== effectivePath &&
        !targetSessionId
      ) {
        confirmModal({
          cancelText: t('heteroAgent.switchCwd.cancel', { ns: 'chat' }),
          content: t('heteroAgent.switchCwd.content', { ns: 'chat' }),
          okText: t('heteroAgent.switchCwd.ok', { ns: 'chat' }),
          onOk: run,
          title: t('heteroAgent.switchCwd.title', { ns: 'chat' }),
        });
        return;
      }
      await run();
    },
    [activeTopic, t, writeCwd],
  );

  /**
   * Set the agent's per-device default cwd, ignoring any active topic. Used by
   * the sidebar "new topic in this directory" (+) action, which always targets
   * a fresh topic regardless of what conversation is currently open — so it must
   * write the same high-precedence slot the picker uses for new topics
   * (`workingDirByDevice`), not the legacy per-agent fallback. The new topic
   * bakes this value into its own `metadata.workingDirectory` on first send.
   */
  const commitAgentDefault = useCallback(
    async (newPath: string, options?: CommitAgentDefaultOptions) => {
      const path = newPath.trim();
      if (!path) return;
      if (targetDeviceId && !isPersonalDeviceTarget) {
        await updateAgentConfigById(
          agentId,
          {
            agencyConfig: {
              workingDirByDevice: { [targetDeviceId]: path },
            },
          },
          { ...options, replaceWorkingDirDeviceIds: [targetDeviceId] },
        );
      } else {
        // No resolvable device (e.g. gateway id unavailable), or a workspace
        // agent targeting this member's own machine (`isPersonalDeviceTarget`,
        // which must never persist into the shared row) — fall back to the
        // per-user legacy slot so the action still takes effect.
        await updateAgentRuntimeEnvConfigById(agentId, { workingDirectory: path });
      }
    },
    [
      agentId,
      isPersonalDeviceTarget,
      targetDeviceId,
      updateAgentConfigById,
      updateAgentRuntimeEnvConfigById,
    ],
  );

  /** Clear the current selection (falls back to the next precedence level). */
  const clear = useCallback(async () => {
    const run = () => clearCwd();

    const priorSessionId = activeTopic?.metadata?.heteroSessionId;
    const priorCwd = activeTopic?.metadata?.workingDirectory;
    if (priorSessionId && priorCwd) {
      confirmModal({
        cancelText: t('heteroAgent.switchCwd.cancel', { ns: 'chat' }),
        content: t('heteroAgent.switchCwd.content', { ns: 'chat' }),
        okText: t('heteroAgent.switchCwd.ok', { ns: 'chat' }),
        onOk: run,
        title: t('heteroAgent.switchCwd.title', { ns: 'chat' }),
      });
      return;
    }
    await run();
  }, [activeTopic, t, clearCwd]);

  return {
    clear,
    commit,
    commitAgentDefault,
    /**
     * A workspace agent's device routing (shared row vs. this member's personal
     * slot) is still resolving. Writers should wait: acting now can file a local
     * path under the shared device instead of the member's own slot.
     */
    isPreferenceLoading,
  };
};
