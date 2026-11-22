import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useHasActiveWorkspace } from '@/business/client/hooks/useHasActiveWorkspace';
import { useAgentShareSupported } from '@/business/client/useAgentShareSupported';
import { useShowAgentIdentity } from '@/features/AgentMail/useShowAgentIdentity';
import { useAgentGraphSupported } from '@/features/AgentSettingsPage/useAgentGraphSupported';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { useSelfLearningSurface } from '@/features/SelfLearning/SurfaceGate/useSelfLearningSurface';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { isMobileSurface } from '@/utils/mobileSurface';

import { type AgentProfileTab, buildAgentProfileTabOptions } from './tabOptions';

/** The profile-group entries this member may open, for any switcher of the group. */
export const useAgentProfileTabOptions = (active: AgentProfileTab, agentId: string) => {
  const { t } = useTranslation(['chat', 'common', 'selfLearning', 'setting', 'spend']);

  const { allowed: canEditContent } = usePermission('edit_own_content');
  const { canEditResource, canManageResource, isAccessResolved } = useResourceAccess(
    'agent',
    agentId,
  );
  const { isAgentEditable } = useServerConfigStore(featureFlagsSelectors);

  const canConfigure = !!isAgentEditable && isAccessResolved && canEditContent && canEditResource;
  const canManageShare =
    !!isAgentEditable && isAccessResolved && canEditContent && canManageResource;
  const hasActiveWorkspace = useHasActiveWorkspace();
  const { visible: shareVisible } = useAgentShareSupported(agentId);
  const mailSupported = useShowAgentIdentity(agentId);
  // One flag switches on everything that wakes an agent from outside: its list and its webhooks.
  const webhookSupported = useServerConfigStore(serverConfigSelectors.enableWebhook);
  const isHeterogeneous = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
  const { enabled: enableSelfLearning } = useSelfLearningSurface();
  // The mobile Segmented has no room for another segment, so mobile keeps the
  // drawer entry in `AgentSidebar/Header/Nav`.
  const selfLearningSupported = enableSelfLearning && !isMobileSurface();
  // Mobile reaches these from the profile header menu instead.
  const agentGraphSupported = useAgentGraphSupported();
  const graphSupported = agentGraphSupported && !isMobileSurface();
  const openingSupported = !isMobileSurface();
  const permissionSupported = hasActiveWorkspace && !isMobileSurface();

  return useMemo(
    () =>
      buildAgentProfileTabOptions({
        active,
        automationsSupported: webhookSupported,
        canConfigure,
        graphSupported,
        labels: {
          'automations': t('tab.automations'),
          'channel': t('tab.integration'),
          'engine': t('tab.engine'),
          'environment': t('tab.environment'),
          'graph': t('agentTab.graph', { ns: 'setting' }),
          'instruction': t('tab.instruction'),
          'knowledge': t('tab.knowledge'),
          'mail': t('tab.mail'),
          'opening': t('agentTab.opening', { ns: 'setting' }),
          'permission': t('permission.page.entry', { ns: 'setting' }),
          // Inside the profile group the whole surface *is* the agent profile,
          // so the first entry is the "basic" tab, not "Agent Profile" again —
          // that broader name stays on the sidebar entry that opens the group.
          'profile': t('tab.profileBasic'),
          'self-evolving': t('title', { ns: 'selfLearning' }),
          'share': t('share', { ns: 'common' }),
          'skills': t('tab.skills'),
          'statistics': t('usageStats.title', { ns: 'spend' }),
          'tools': t('tab.tools'),
          'webhook': t('tab.webhook'),
        },
        mailSupported,
        openingSupported,
        permissionSupported,
        selfLearningSupported,
        shareSupported: shareVisible === true && canManageShare,
        heterogeneous: isHeterogeneous,
        webhookSupported,
      }),
    [
      active,
      canConfigure,
      canManageShare,
      graphSupported,
      isHeterogeneous,
      mailSupported,
      openingSupported,
      permissionSupported,
      selfLearningSupported,
      shareVisible,
      t,
      webhookSupported,
    ],
  );
};
