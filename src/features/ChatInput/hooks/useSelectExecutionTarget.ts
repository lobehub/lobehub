'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceExecutionTarget } from '@lobechat/types';
import { useCallback } from 'react';

import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';

/**
 * Persist an execution-target selection for an agent. Shared by the device
 * switcher and the sandbox notice so the `local` device-id resolution (which
 * has to find this machine's gateway `deviceId`) lives in one place.
 *
 * `executionTarget` is the single source of truth — the server tool gate +
 * client `getRuntimeModeById` derive `runtimeMode` from it.
 *
 * Storage split (LOBE-11689):
 * - **Personal agent** — writes go straight into the shared
 *   `agents.agencyConfig` (there's only ever one owner, so there's nothing to
 *   isolate).
 * - **Workspace agent** — writes go into
 *   `workspace_user_settings.preference.agentDeviceOverrides[agentId]`
 *   (per-user per-workspace) so each member's Cloud Sandbox / workspace-device
 *   / this-machine choice stays independent. The shared `agents.agencyConfig`
 *   is left as-is, becoming the group-wide fallback for members who haven't
 *   chosen anything yet. Reads / writes are cached through the
 *   `workspaceUserSettings` slice of the user store, keyed on the active
 *   workspaceId.
 *
 * `local` is stored verbatim (`{ executionTarget: 'local', boundDeviceId: <me> }`)
 * so both desktop dispatch (in-process IPC — the fast path) and web dispatch
 * (server-side coercion to `device` via the existing gateway rule) keep their
 * respective semantics. That's why the old
 * `if (target === 'local' && isWorkspaceAgent) return;` guard is gone: with
 * per-user overrides my choice can't hurt other members.
 */
export const useSelectExecutionTarget = (agentId: string) => {
  const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const isHetero = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
  const isWorkspaceAgent = useAgentStore((s) => Boolean(s.agentMap[agentId]?.workspaceId));
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);

  const updateWorkspaceUserPreference = useUserStore((s) => s.updateWorkspaceUserPreference);
  // Latest known bucket so the write below can splice a single agentId leaf
  // without stomping any of the caller's other agent overrides in this
  // workspace. Optimistic merge inside the action keeps this in sync.
  const workspaceUserPreference = useUserStore((s) => s.workspaceUserPreference);

  // The current machine's own gateway deviceId (desktop only); used to pin a
  // `local` selection to this device.
  const gatewayDeviceInfo = useElectronStore((s) => s.gatewayDeviceInfo);
  const currentDeviceId = isDesktop ? gatewayDeviceInfo?.deviceId : undefined;

  return useCallback(
    async (target: DeviceExecutionTarget, deviceId?: string) => {
      // Fixed workspace agents are author-controlled. Keep any existing member
      // override dormant (so switching back to member choice restores it), but
      // never let this picker create or update an override while fixed.
      if (isWorkspaceAgent && agencyConfig?.executionTargetSelectionPolicy === 'fixed') return;

      const boundDeviceId = agencyConfig?.boundDeviceId;
      let nextBoundDeviceId = target === 'device' ? deviceId : boundDeviceId;
      if (target === 'local') {
        nextBoundDeviceId = currentDeviceId;
        if (!nextBoundDeviceId) {
          try {
            nextBoundDeviceId = (await gatewayConnectionService.getDeviceInfo())?.deviceId;
          } catch {
            nextBoundDeviceId = undefined;
          }
        }
        // Hetero agents must execute somewhere; without a resolvable local
        // device there is nothing to pin `local` to, so don't switch.
        if (isHetero && !nextBoundDeviceId) return;
      }

      // Store the intent verbatim (`local` stays `local`), not a
      // pre-resolved `device`. Two reasons:
      //
      // 1. Semantic parity with personal agents. `local` and `device` are
      //    distinct at dispatch time — `local` runs in-process on the
      //    desktop, `device` tunnels through the gateway (even when the
      //    bound device *is* this desktop). Persisting `device` would rob a
      //    workspace-mode `local` pick of the faster in-process path when
      //    the run happens on this desktop, and change personal-agent
      //    behaviour (which used to store `local` verbatim).
      // 2. On surfaces without a client (web / server dispatch),
      //    `resolveExecutionTarget` already coerces a stored `local` +
      //    `boundDeviceId` to `device` when a gateway is available, so the
      //    server-side dispatch path Just Works — no need to pre-coerce here.
      if (isWorkspaceAgent) {
        const nextOverrides = {
          ...workspaceUserPreference.agentDeviceOverrides,
          [agentId]: {
            executionTarget: target,
            ...(nextBoundDeviceId ? { boundDeviceId: nextBoundDeviceId } : {}),
          },
        };
        await updateWorkspaceUserPreference({ agentDeviceOverrides: nextOverrides });
        return;
      }

      await updateAgentConfigById(agentId, {
        agencyConfig: {
          ...agencyConfig,
          executionTarget: target,
          ...(nextBoundDeviceId ? { boundDeviceId: nextBoundDeviceId } : {}),
        },
      });
    },
    [
      agentId,
      agencyConfig,
      currentDeviceId,
      isHetero,
      isWorkspaceAgent,
      updateAgentConfigById,
      updateWorkspaceUserPreference,
      workspaceUserPreference,
    ],
  );
};
