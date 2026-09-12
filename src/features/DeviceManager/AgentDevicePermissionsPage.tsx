import { Flexbox } from '@lobehub/ui';
import { Navigate, useParams } from 'react-router';

import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import AgentProfileTabs, { AGENT_PROFILE_TABS_CENTER_STYLE } from '@/features/AgentProfileTabs';
import NavHeader from '@/features/NavHeader';
import ResourceConfigAccessGate from '@/features/ResourcePermission/ResourceConfigAccessGate';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { DevicePoolManager } from './DevicePoolManager';

const Loading = createSurfaceSkeleton('form');

/**
 * Renders device-pool overrides in the Agent's top-level configuration tabs.
 *
 * Use when:
 * - An editor opens an Agent's device permissions
 *
 * Expects:
 * - The Agent route context has loaded the current Agent
 *
 * Returns:
 * - A configuration-gated page with pool-specific, automatically saved overrides
 */
export default function AgentDevicePermissionsPage() {
  const { aid } = useParams<{ aid: string }>();
  const workspace = useAgentStore(agentByIdSelectors.isWorkspaceAgentById(aid ?? ''));
  const initialized = useUserStore((s) => s.isUserStateInit);
  const enabled = useUserStore(labPreferSelectors.enableDevicePools);
  if (!initialized) return <Loading />;
  if (!enabled) return <Navigate replace to="../profile" />;
  return (
    <ResourceConfigAccessGate
      loading={<Loading />}
      redirectPath={`/agent/${aid ?? ''}`}
      resourceId={aid}
      resourceType="agent"
    >
      <Flexbox height="100%" width="100%">
        <NavHeader
          left={aid ? <AgentBreadcrumb agentId={aid} /> : null}
          style={{ position: 'relative' }}
          styles={{
            center: AGENT_PROFILE_TABS_CENTER_STYLE,
            left: { minWidth: 0, paddingInlineStart: 8 },
          }}
        >
          {aid && <AgentProfileTabs active="devices" agentId={aid} />}
        </NavHeader>
        <Flexbox flex={1} style={{ overflowY: 'auto' }}>
          <WideScreenContainer>
            {aid && (
              <DevicePoolManager agentId={aid} scope={workspace ? 'workspace' : 'personal'} />
            )}
          </WideScreenContainer>
        </Flexbox>
      </Flexbox>
    </ResourceConfigAccessGate>
  );
}
