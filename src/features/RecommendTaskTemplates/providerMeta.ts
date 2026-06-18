import type {
  LobehubSkillProviderType,
  TaskTemplateConnectorReference,
  TaskTemplateConnectorSource,
} from '@lobechat/const';
import { getComposioAppByIdentifier, getLobehubSkillProviderById } from '@lobechat/const';

export interface SkillProviderMeta {
  icon: LobehubSkillProviderType['icon'];
  identifier: string;
  label: string;
  source: TaskTemplateConnectorSource;
}

export const getProviderMeta = (
  spec: TaskTemplateConnectorReference,
): SkillProviderMeta | undefined => {
  if (spec.source === 'lobehub') {
    const p = getLobehubSkillProviderById(spec.identifier);
    if (!p) return undefined;
    return { icon: p.icon, identifier: spec.identifier, label: p.label, source: 'lobehub' };
  }
  const p = getComposioAppByIdentifier(spec.identifier);
  if (!p) return undefined;
  return { icon: p.icon, identifier: spec.identifier, label: p.label, source: 'composio' };
};

export const findNextUnconnectedSpec = (
  specs: TaskTemplateConnectorReference[] | undefined,
  isConnected: (spec: TaskTemplateConnectorReference) => boolean,
): SkillProviderMeta | undefined => {
  if (!specs || specs.length === 0) return undefined;
  for (const spec of specs) {
    if (isConnected(spec)) continue;
    const meta = getProviderMeta(spec);
    if (!meta) continue;
    return meta;
  }
  return undefined;
};
