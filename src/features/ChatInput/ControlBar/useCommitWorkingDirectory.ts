import type { WorkingDirEntry } from '@lobechat/types';
import { confirmModal } from '@lobehub/ui/base-ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';

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
 * per-cwd), so warn before the implicit reset — same as the legacy pickers.
 */
export const useCommitWorkingDirectory = (agentId: string) => {
  const { t } = useTranslation(['plugin', 'chat']);

  const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const updateAgentRuntimeEnvConfigById = useAgentStore((s) => s.updateAgentRuntimeEnvConfigById);
  const legacyAgentWorkingDirectory = useAgentStore(
    (s) => s.localAgentWorkingDirectoryMap[agentId],
  );

  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const activeTopic = useChatStore((s) =>
    s.activeTopicId ? topicSelectors.getTopicById(s.activeTopicId)(s) : undefined,
  );
  const updateTopicMetadata = useChatStore((s) => s.updateTopicMetadata);

  const updateDeviceCwd = useDeviceStore((s) => s.updateDeviceCwd);
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId);

  const writeCwd = useCallback(
    async (newPath: string, entry?: WorkingDirEntry) => {
      // Topic override wins once a conversation exists; otherwise persist the
      // agent's per-device choice so a new topic inherits it.
      if (activeTopicId) {
        await updateTopicMetadata(activeTopicId, { workingDirectory: newPath });
      } else if (targetDeviceId) {
        const prev = agencyConfig?.workingDirByDevice ?? {};
        await updateAgentConfigById(agentId, {
          agencyConfig: {
            ...agencyConfig,
            workingDirByDevice: { ...prev, [targetDeviceId]: newPath },
          },
        });
      }
      // Record on the target device's recent list (not the device-wide default —
      // a per-agent pick shouldn't repoint other agents on the same device).
      if (entry && targetDeviceId) {
        await updateDeviceCwd(targetDeviceId, { ...entry, path: newPath }, { setDefault: false });
      }
    },
    [
      agentId,
      agencyConfig,
      activeTopicId,
      targetDeviceId,
      updateAgentConfigById,
      updateTopicMetadata,
      updateDeviceCwd,
    ],
  );

  // Clear whichever precedence level currently supplies the cwd, so the picker
  // falls back to the next level (agent default → device default → "not set").
  const clearCwd = useCallback(async () => {
    // A topic override (when present) is the effective source — drop it first so
    // we fall back to the agent default rather than nuking everything.
    if (activeTopicId && activeTopic?.metadata?.workingDirectory) {
      await updateTopicMetadata(activeTopicId, { workingDirectory: undefined });
      return;
    }
    // No topic override: clear the agent-level default(s). Clearing sends
    // `undefined` rather than dropping the key — deep-merge (client store +
    // server persist) can't remove a key, so the delete is carried as an
    // explicit `undefined` and pruned after each merge. The user can't tell the
    // per-device map from the legacy slot, so clear both together to avoid a
    // dead second click.
    if (targetDeviceId && agencyConfig?.workingDirByDevice?.[targetDeviceId]) {
      const nextMap: Record<string, string | undefined> = {
        ...agencyConfig.workingDirByDevice,
        [targetDeviceId]: undefined,
      };
      await updateAgentConfigById(agentId, {
        agencyConfig: { ...agencyConfig, workingDirByDevice: nextMap },
      });
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
  ]);

  /** Pick a directory (with the CC-session-reset guard). */
  const commit = useCallback(
    async (entry: WorkingDirEntry) => {
      const newPath = entry.path.trim();
      if (!newPath) return;

      const run = () => writeCwd(newPath, entry);

      const priorSessionId = activeTopic?.metadata?.heteroSessionId;
      const priorCwd = activeTopic?.metadata?.workingDirectory;
      if (priorSessionId && priorCwd && priorCwd !== newPath) {
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
    async (newPath: string) => {
      const path = newPath.trim();
      if (!path) return;
      if (targetDeviceId) {
        const prev = agencyConfig?.workingDirByDevice ?? {};
        await updateAgentConfigById(agentId, {
          agencyConfig: {
            ...agencyConfig,
            workingDirByDevice: { ...prev, [targetDeviceId]: path },
          },
        });
      } else {
        // No resolvable device (e.g. gateway id unavailable) — fall back to the
        // legacy per-agent slot so the action still takes effect.
        await updateAgentRuntimeEnvConfigById(agentId, { workingDirectory: path });
      }
    },
    [agentId, agencyConfig, targetDeviceId, updateAgentConfigById, updateAgentRuntimeEnvConfigById],
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

  return { clear, commit, commitAgentDefault };
};
