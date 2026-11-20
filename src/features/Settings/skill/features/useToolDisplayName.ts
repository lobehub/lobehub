import { getComposioAppByIdentifier, getLobehubSkillProviderById } from '@lobechat/const';
import type { ConnectorVisibility } from '@lobechat/types';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors, pluginSelectors } from '@/store/tool/selectors';
import { connectorSelectors } from '@/store/tool/slices/connector';

import type { ToolDetailType } from './SkillDetail';

/**
 * The name a list row shows for the entry a detail page opened, so the
 * breadcrumb reads `Connectors › <the row you clicked>`. Falls back to the
 * identifier while the entry is still loading.
 */
export const useToolDisplayName = (
  identifier: string,
  type: ToolDetailType,
  visibility?: ConnectorVisibility,
): string => {
  const { t } = useTranslation('setting');

  const builtinTitle = useToolStore((s) =>
    type === 'builtin'
      ? s.builtinTools.find((tool) => tool.identifier === identifier)?.title
      : s.builtinSkills.find((skill) => skill.identifier === identifier)?.name,
  );
  const skillName = useToolStore((s) =>
    type === 'agent-skill'
      ? (agentSkillsSelectors.getAgentSkills(s).find((skill) => skill.id === identifier)?.name ??
        agentSkillsSelectors.getAgentSkillDetail(identifier)(s)?.name)
      : undefined,
  );
  const connectorName = useToolStore((s) =>
    type === 'agent-connector'
      ? (s.agentBoundConnectors ?? []).find((c) => c.id === identifier)?.name
      : connectorSelectors.connectorByIdentifier(identifier, visibility)(s)?.name,
  );
  const pluginTitle = useToolStore((s) =>
    type === 'plugin' ? pluginSelectors.getPluginMetaById(identifier)(s)?.title : undefined,
  );

  if (type === 'agent-skill') return skillName || identifier;
  if (type === 'builtin' || type === 'builtin-skill')
    return t(`tools.builtins.${identifier}.title`, { defaultValue: builtinTitle || identifier });
  const brand = getComposioAppByIdentifier(identifier) ?? getLobehubSkillProviderById(identifier);
  return brand?.label || pluginTitle || connectorName || identifier;
};
