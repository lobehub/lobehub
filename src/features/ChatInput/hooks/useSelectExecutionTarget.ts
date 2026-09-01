'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceExecutionTarget } from '@lobechat/types';
import { toast } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { useCallback } from 'react';

import { useAgentManagementAccess } from '@/features/ResourcePermission/useAgentManagementAccess';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';

export interface SelectExecutionTargetOptions {
  /**
   * Confine this agent's shell commands to the device sandbox. Only meaningful
   * alongside `target: 'local'`; the picker passes `false` for the plain local
   * row so switching back off is an explicit write rather than a leftover.
   *
   * Omitted entirely for the other targets, which leaves any stored value
   * dormant — flipping to Cloud Sandbox and back must not silently forget that
   * the user had fenced their machine.
   */
  localSandbox?: boolean;
  /**
   * Let sandboxed commands reach the package-registry allowlist. Same
   * omitted-means-untouched rule as {@link localSandbox}.
   */
  localSandboxNetwork?: boolean;
  /**
   * The call is an automatic default (agent has no target yet), not a user's
   * pick. Persistence failures stay silent — a generic "your change was not
   * applied" toast would be about a change the user never made.
   */
  silent?: boolean;
}

/**
 * Persist an execution-target selection for an agent. Shared by the device
 * switcher and the sandbox notice so the `local` device-id resolution (which
 * has to find this machine's gateway `deviceId`) lives in one place.
 *
 * `executionTarget` is the single source of truth — the server tool gate +
 * client `getRuntimeModeById` derive `runtimeMode` from it.
 *
 * Storage split:
 * - **Personal agent** — writes go straight into the shared
 *   `agents.agencyConfig` (there's only ever one owner, so there's nothing to
 *   isolate).
 * - **Public Workspace agent** — writes go into
 *   `workspace_user_settings.preference.agentDeviceOverrides[agentId]`
 *   (per-user per-workspace) so each member's Cloud Sandbox / workspace-device
 *   / this-machine choice stays independent. The shared `agents.agencyConfig`
 *   is left as-is, becoming the group-wide fallback for members who haven't
 *   chosen anything yet. Reads / writes are cached through the
 *   `workspaceUserSettings` slice of the user store, keyed on the active
 *   workspaceId.
 * - **Private Workspace agent** — like a personal agent, writes go directly to
 *   `agents.agencyConfig`; the member-selection policy takes effect only after
 *   the Agent is published.
 * - **`local` on ANY workspace agent** — always the per-user override, even for
 *   managers and private-agent owners who otherwise write the shared row: a
 *   `local` pick binds this member's personal desktop device, and the server
 *   rejects a workspace agent whose shared config references a device not
 *   enrolled in the workspace (`WorkspaceAgentRequiresWorkspaceDevice`).
 *   Conversely, a manager's shared-target pick clears their own override's
 *   routing keys so a previous `local` pick cannot keep shadowing it.
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
  const isPublicWorkspaceAgent = useAgentStore((s) => {
    const agent = s.agentMap[agentId];
    return !!agent?.workspaceId && agent.visibility !== 'private';
  });
  const { canManageAgent, isAccessLoading } = useAgentManagementAccess(agentId);
  const usesWorkspaceMemberSelection = isPublicWorkspaceAgent && !canManageAgent;
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
    async (
      target: DeviceExecutionTarget,
      deviceId?: string,
      options?: SelectExecutionTargetOptions,
    ) => {
      if (isAccessLoading) return;

      // Fixed workspace agents are author-controlled. Keep any existing member
      // override dormant (so switching back to member choice restores it), but
      // never let this picker create or update an override while fixed.
      if (usesWorkspaceMemberSelection && agencyConfig?.executionTargetSelectionPolicy === 'fixed')
        return;

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
      // `undefined` leaves the stored value untouched; `false` actively clears
      // it. Only the two local rows have an opinion, so a Cloud Sandbox pick
      // never rewrites the fence the user set on their own machine.
      const localSandboxPatch = {
        ...(options?.localSandbox === undefined ? {} : { localSandbox: options.localSandbox }),
        ...(options?.localSandboxNetwork === undefined
          ? {}
          : { localSandboxNetwork: options.localSandboxNetwork }),
      };

      // A `local` pick on a workspace agent is always this caller's own
      // machine — a personal device the workspace-shared row must never
      // reference (the server rejects it) — so it routes to the per-user
      // override even for managers and private-agent owners.
      if (usesWorkspaceMemberSelection || (isWorkspaceAgent && target === 'local')) {
        const nextOverrides = {
          ...workspaceUserPreference.agentDeviceOverrides,
          [agentId]: {
            ...workspaceUserPreference.agentDeviceOverrides?.[agentId],
            executionTarget: target,
            ...(nextBoundDeviceId ? { boundDeviceId: nextBoundDeviceId } : {}),
            ...localSandboxPatch,
          },
        };
        await updateWorkspaceUserPreference({ agentDeviceOverrides: nextOverrides });
        return;
      }

      const nextConfig = {
        agencyConfig: {
          ...agencyConfig,
          executionTarget: target,
          ...(nextBoundDeviceId ? { boundDeviceId: nextBoundDeviceId } : {}),
          ...localSandboxPatch,
        },
      };

      // A silent caller is defaulting the target on mount, not answering a
      // pick — telling the user "your change was not applied" would be
      // reporting a change they never made (automatic corrections must not trigger phantom save-error toasts).
      //
      // `rethrow` so a failed shared save (network error, server validation)
      // stops here: the store already rolled the optimistic config back and
      // toasted, and clearing the caller's override below would additionally
      // destroy their previously valid personal target over a save that never
      // happened.
      try {
        await updateAgentConfigById(agentId, nextConfig, {
          rethrow: true,
          ...(options?.silent ? { showErrorMessage: false } : {}),
        });
      } catch {
        return;
      }

      // A manager's earlier `local` pick lives in their own override and would
      // keep shadowing the shared target they just wrote — drop the override's
      // routing keys. The sandbox fence stays: it qualifies their machine, not
      // this pick.
      const prevOverride = workspaceUserPreference.agentDeviceOverrides?.[agentId];
      if (
        isWorkspaceAgent &&
        prevOverride &&
        (prevOverride.executionTarget !== undefined || prevOverride.boundDeviceId !== undefined)
      ) {
        const { boundDeviceId: _device, executionTarget: _target, ...dormant } = prevOverride;
        try {
          await updateWorkspaceUserPreference({
            agentDeviceOverrides: {
              ...workspaceUserPreference.agentDeviceOverrides,
              [agentId]: dormant,
            },
          });
        } catch {
          // The preference store rolled the override back, so the old `local`
          // pick would keep shadowing the shared target that DID persist —
          // split state. Compensate by restoring the previous shared config
          // (best effort, no double toast) so the surviving override shadows
          // the same target the user had before this pick.
          await updateAgentConfigById(
            agentId,
            { agencyConfig: { ...agencyConfig } },
            { showErrorMessage: false },
          );
          if (!options?.silent) toast.error(t('saveAgentConfigFail', { ns: 'common' }));
        }
      }
    },
    [
      agentId,
      agencyConfig,
      currentDeviceId,
      isHetero,
      isAccessLoading,
      isWorkspaceAgent,
      updateAgentConfigById,
      updateWorkspaceUserPreference,
      usesWorkspaceMemberSelection,
      workspaceUserPreference,
    ],
  );
};
