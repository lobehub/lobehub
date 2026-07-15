'use client';

import { isDesktop } from '@lobechat/const';
import { memo } from 'react';

import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';

import CloudRepoSwitcher from './CloudRepoSwitcher';
import HeteroDeviceSwitcher from './HeteroDeviceSwitcher';
import WorkingDirectorySection from './WorkingDirectorySection';

interface WorkspaceControlsProps {
  agentId: string;
  /**
   * Force the workspace (directory + branch + file changes + PR) to show even
   * when the runtime isn't in local mode. Heterogeneous agents always run inside
   * a working directory, so they pass `true`; normal agents only surface it in
   * local mode.
   */
  alwaysShowWorkspace?: boolean;
}

/**
 * Workspace/Project control strip shared by the chat-input control bars:
 * device selector + working directory + git branch / file changes / PR info.
 *
 * Both ControlBar (normal agents) and HeteroControlBar (heterogeneous agents)
 * compose this, so the Device / Branch / diff / PR cluster can't drift between
 * them. The bar-specific bits (ModeSelector, ApprovalMode, ContextWindow, the
 * full-access badge) stay in their respective bars.
 */
const WorkspaceControls = memo<WorkspaceControlsProps>(
  ({ agentId, alwaysShowWorkspace = false }) => {
    const runtimeMode = useAgentStore(chatConfigByIdSelectors.getRuntimeModeById(agentId));
    const isHeterogeneous = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
    // Effective config = shared row + this member's device override (LOBE-11689),
    // so `isDeviceMode` routes the working-directory section by the device THIS
    // member's run actually targets.
    const { agencyConfig } = useEffectiveAgencyConfig(agentId);
    const deviceRoutingAvailable = useIsGatewayModeEnabled(agentId);
    const isWorkspaceAgent = useAgentStore(agentByIdSelectors.isWorkspaceAgentById(agentId));
    const effectiveTarget = resolveExecutionTarget(agencyConfig, {
      clientExecutionAvailable: isDesktop,
      deviceRoutingAvailable,
      isHetero: isHeterogeneous,
      workspaceScoped: isWorkspaceAgent,
    });
    const isDeviceMode = effectiveTarget === 'device' && !!agencyConfig?.boundDeviceId;

    const renderWorkspace = () => {
      // Remote device runs get the device-scoped picker, regardless of runtimeMode
      // (HeteroDeviceSwitcher sets runtimeMode to 'none' when a device is selected).
      if (isDeviceMode) return <WorkingDirectorySection agentId={agentId} />;

      // Web has no local filesystem — cloud / heterogeneous agents browse the repo
      // through the cloud repo switcher instead.
      if (!isDesktop) {
        return isHeterogeneous || alwaysShowWorkspace ? (
          <CloudRepoSwitcher agentId={agentId} />
        ) : null;
      }

      // Desktop: local working directory + git branch / diff / PR. Shown when the
      // run is local, or always for heterogeneous agents (they always have a cwd).
      if (alwaysShowWorkspace || runtimeMode === 'local') {
        return <WorkingDirectorySection agentId={agentId} />;
      }

      return null;
    };

    return (
      <>
        <HeteroDeviceSwitcher agentId={agentId} />
        {renderWorkspace()}
      </>
    );
  },
);

WorkspaceControls.displayName = 'WorkspaceControls';

export default WorkspaceControls;
