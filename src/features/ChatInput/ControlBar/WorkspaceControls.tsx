'use client';

import { Tooltip } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatInputResourceAccess } from '@/features/ChatInput/hooks/useChatInputResourceAccess';

import CloudRepoSwitcher from './CloudRepoSwitcher';
import HeteroDeviceSwitcher from './HeteroDeviceSwitcher';
import { useWorkspaceSurface } from './useWorkspaceSurface';
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
    // surface follows the device THIS member's run actually targets.
    const surface = useWorkspaceSurface(agentId, alwaysShowWorkspace);

    const renderWorkspace = () => {
      switch (surface) {
        case 'workingDirectory': {
          return <WorkingDirectorySection agentId={agentId} />;
        }
        case 'cloudRepo': {
          return <CloudRepoSwitcher agentId={agentId} />;
        }
        default: {
          return null;
        }
      }
    };

    // The directory picker and git controls write shared agent config / run
    // device git mutations, so members without edit access see the whole
    // cluster disabled. The device switcher handles its own use-level gate.
    const workspace = renderWorkspace();

    return (
      <>
        <HeteroDeviceSwitcher agentId={agentId} />
        {workspace &&
          (canConfigureResource ? (
            workspace
          ) : (
            <Tooltip
              title={t(
                canUseResource
                  ? 'permission.accessTag.useOnlyTip'
                  : 'permission.accessTag.viewOnlyTip',
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
                  {workspace}
                </div>
              </div>
            </Tooltip>
          ))}
      </>
    );
  },
);

WorkspaceControls.displayName = 'WorkspaceControls';

export default WorkspaceControls;
