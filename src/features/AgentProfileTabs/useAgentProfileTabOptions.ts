import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentShareSupported } from '@/business/client/useAgentShareSupported';
import { useShowAgentIdentity } from '@/features/AgentMail/useShowAgentIdentity';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { useSelfLearningSurface } from '@/features/SelfLearning/SurfaceGate/useSelfLearningSurface';
import { usePermission } from '@/hooks/usePermission';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { isMobileSurface } from '@/utils/mobileSurface';

import { type AgentProfileTab, buildAgentProfileTabOptions } from './tabOptions';

/** The profile-group entries this member may open, for any switcher of the group. */
export const useAgentProfileTabOptions = (active: AgentProfileTab, agentId: string) => {
  const { t } = useTranslation(['chat', 'common', 'selfLearning', 'spend']);

  const { allowed: canEditContent } = usePermission('edit_own_content');
  const { canEditResource, canManageResource, isAccessResolved } = useResourceAccess(
    'agent',
    agentId,
  );
  const { isAgentEditable } = useServerConfigStore(featureFlagsSelectors);

  const canConfigure = !!isAgentEditable && isAccessResolved && canEditContent && canEditResource;
  const canManageShare =
    !!isAgentEditable && isAccessResolved && canEditContent && canManageResource;
  const { visible: shareVisible } = useAgentShareSupported(agentId);
  const mailSupported = useShowAgentIdentity(agentId);
  const { enabled: enableSelfLearning } = useSelfLearningSurface();
  // The mobile Segmented has no room for another segment, so mobile keeps the
  // drawer entry in `AgentSidebar/Header/Nav`.
  const selfLearningSupported = enableSelfLearning && !isMobileSurface();

  return useMemo(
    () =>
      buildAgentProfileTabOptions({
        active,
        canConfigure,
        labels: {
          'channel': t('tab.integration'),
          'mail': t('tab.mail'),
          // Inside the profile group the whole surface *is* the agent profile,
          // so the first entry is the "basic" tab, not "Agent Profile" again —
          // that broader name stays on the sidebar entry that opens the group.
          'profile': t('tab.profileBasic'),
          'self-evolving': t('title', { ns: 'selfLearning' }),
          'share': t('share', { ns: 'common' }),
          'statistics': t('usageStats.title', { ns: 'spend' }),
        },
        mailSupported,
        selfLearningSupported,
        shareSupported: shareVisible === true && canManageShare,
      }),
    [active, canConfigure, canManageShare, mailSupported, selfLearningSupported, shareVisible, t],
  );
};
