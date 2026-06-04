import type {
  LobehubSkillProviderType,
  TaskTemplateSkillRequirement,
  TaskTemplateSkillSource,
} from '@lobechat/const';
import { getComposioAppByIdentifier, getLobehubSkillProviderById } from '@lobechat/const';

export interface SkillProviderMeta {
  icon: LobehubSkillProviderType['icon'];
  label: string;
  provider: string;
  source: TaskTemplateSkillSource;
}

export const getProviderMeta = (
  spec: TaskTemplateSkillRequirement,
): SkillProviderMeta | undefined => {
  if (spec.source === 'lobehub') {
    const p = getLobehubSkillProviderById(spec.provider);
    if (!p) return undefined;
    return { icon: p.icon, label: p.label, provider: spec.provider, source: 'lobehub' };
  }
  const p = getComposioAppByIdentifier(spec.provider);
  if (!p) return undefined;
  return { icon: p.icon, label: p.label, provider: spec.provider, source: 'composio' };
};

export const findNextUnconnectedSpec = (
  specs: TaskTemplateSkillRequirement[] | undefined,
  isConnected: (spec: TaskTemplateSkillRequirement) => boolean,
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
