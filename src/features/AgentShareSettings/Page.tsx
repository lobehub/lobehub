'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Navigate } from 'react-router';

import AgentShareSettingsExtension from '@/business/client/features/AgentShareSettingsExtension';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import AgentProfileTabs, { AGENT_PROFILE_TABS_CENTER_STYLE } from '@/features/AgentProfileTabs';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentStore } from '@/store/agent';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { StyleSheet } from '@/utils/styles';

import SettingsContent from './SettingsContent';
import { useAgentShare } from './useAgentShare';
import VisibilitySection from './VisibilitySection';

const styles = StyleSheet.create({
  body: {
    display: 'flex',
    overflowY: 'auto',
    position: 'relative',
  },
});

/**
 * Full-page share management for one agent: visibility + link on
 * top, business budget/usage slot in the middle, then the permission / tool /
 * limit configuration. Replaces the previous share popover + settings modal —
 * sharing an agent grants visitors real execution on the creator's account, so
 * the flow deserves a deliberate page, not a quick popup.
 */
const AgentShareSettingsPage = memo(() => {
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  // Business capability (cloud-only) AND per-user grayscale flag, mirroring
  // the server gate in `_helpers/agentShareFeatureGate.ts`.
  const enableAgentShareFlag = !!useServerConfigStore((s) => s.featureFlags.enableAgentShare);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  // Flags hold their store defaults (false) until the async global-config fetch
  // lands, so any redirect decided before init would bounce an enabled creator
  // off their own deep link.
  const isServerConfigInit = useServerConfigStore((s) => s.serverConfigInit);

  // A creator removed from the grayscale whitelist must keep a revocation
  // surface for an already-live share: visitors are admitted by the share row
  // regardless of the creator's current flag, so this page cannot disappear
  // with the flag. Peek at the share row without auto-creating one (creation
  // is server-forbidden for non-whitelisted users anyway).
  const shouldPeekExistingShare =
    isServerConfigInit && enableBusinessFeatures && !enableAgentShareFlag;
  const { isLoading: isShareStatusLoading, shareInfo } = useAgentShare(
    activeAgentId,
    shouldPeekExistingShare,
    { autoCreate: false },
  );

  const enableAgentLinkShare = enableBusinessFeatures && enableAgentShareFlag;
  const revocationOnly = shouldPeekExistingShare && !!shareInfo;

  // Nothing to render/redirect on until the flags (and, for a flag-off
  // creator, the share-row peek) have resolved.
  if (!isServerConfigInit || (shouldPeekExistingShare && isShareStatusLoading)) return null;

  // Deep links on deployments without the link-share capability (or for users
  // outside the grayscale with no live share) land on the profile page
  // instead of a broken settings surface.
  if (!enableAgentLinkShare && !revocationOnly && activeAgentId)
    return <Navigate replace to={`/agent/${activeAgentId}/profile`} />;

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader
        // No section title — the Segmented beside it names the current tab.
        left={activeAgentId ? <AgentBreadcrumb agentId={activeAgentId} /> : null}
        // `relative` anchors the absolutely-centered switcher below.
        style={{ position: 'relative' }}
        styles={{
          // Center on the header midpoint (equal gaps), not the leftover track.
          center: AGENT_PROFILE_TABS_CENTER_STYLE,
          left: { minWidth: 0, paddingInlineStart: 8 },
        }}
      >
        {activeAgentId && <AgentProfileTabs active={'share'} agentId={activeAgentId} />}
      </NavHeader>
      <Flexbox flex={1} style={styles.body} width={'100%'}>
        <WideScreenContainer>
          <Flexbox gap={16} paddingBlock={16}>
            {activeAgentId && (
              <>
                <VisibilitySection agentId={activeAgentId} allowPublish={!revocationOnly} />
                {/* Config edits (budget slot + permission/tool/limit settings)
                    go through `updateShareConfig`, which the server forbids for
                    non-whitelisted creators — revocation mode keeps only the
                    visibility control that can shut the share down. */}
                {!revocationOnly && (
                  <>
                    <AgentShareSettingsExtension agentId={activeAgentId} />
                    <SettingsContent agentId={activeAgentId} />
                  </>
                )}
              </>
            )}
          </Flexbox>
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

AgentShareSettingsPage.displayName = 'AgentShareSettingsPage';

export default AgentShareSettingsPage;
