'use client';

import { Tooltip } from '@lobehub/ui';
import { Fragment, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatInputResourceAccess } from '@/features/ChatInput/hooks/useChatInputResourceAccess';

import CloudRepoSwitcher from './CloudRepoSwitcher';
import HeteroDeviceSwitcher from './HeteroDeviceSwitcher';
import SandboxWorkspaceSection from './SandboxWorkspaceSection';
import { useWorkspaceSurface, type WorkspaceSurface } from './useWorkspaceSurface';
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
    const { t } = useTranslation('setting');
    const { canConfigureResource, canUseResource } = useChatInputResourceAccess();
    // Resolved from the effective (override-merged) execution target so the
    // surfaces follow the device THIS member's run actually targets.
    const surfaces = useWorkspaceSurface(agentId, alwaysShowWorkspace);

    const renderSurface = (surface: WorkspaceSurface) => {
      switch (surface) {
        case 'workingDirectory': {
          return <WorkingDirectorySection agentId={agentId} />;
        }
        case 'cloudRepo': {
          return <CloudRepoSwitcher agentId={agentId} />;
        }
        case 'sandbox': {
          return <SandboxWorkspaceSection agentId={agentId} />;
        }
      }
    };

    // The directory picker and git controls write shared agent config / run
    // device git mutations, so members without edit access see that cluster
    // disabled. The device switcher handles its own use-level gate.
    //
    // The sandbox is exempt: its choice lands in the topic's own metadata, not
    // in the shared agent row, so a member who may use the agent may choose
    // where their own run keeps its files. Gated one surface at a time, so a
    // run that shows both keeps the sandbox chip live while the repo switcher
    // is inert.
    const withAccessGate = (surface: WorkspaceSurface) => {
      const node = renderSurface(surface);
      if (canConfigureResource || surface === 'sandbox') return node;

      return (
        <Tooltip
          title={t(
            canUseResource ? 'permission.accessTag.useOnlyTip' : 'permission.accessTag.viewOnlyTip',
          )}
        >
          {/* Outer div catches hover for the tooltip; the inner one makes
              the controls inert. */}
          <div style={{ alignItems: 'center', display: 'flex', gap: 4 }}>
            <div
              style={{
                alignItems: 'center',
                display: 'flex',
                gap: 4,
                opacity: 0.5,
                pointerEvents: 'none',
              }}
            >
              {node}
            </div>
          </div>
        </Tooltip>
      );
    };

    return (
      <>
        <HeteroDeviceSwitcher agentId={agentId} />
        {surfaces.map((surface) => (
          <Fragment key={surface}>{withAccessGate(surface)}</Fragment>
        ))}
      </>
    );
  },
);

WorkspaceControls.displayName = 'WorkspaceControls';

export default WorkspaceControls;
