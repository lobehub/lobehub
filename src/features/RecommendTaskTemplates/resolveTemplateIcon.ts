import type { IconType } from '@icons-pack/react-simple-icons';
import { SiGithub } from '@icons-pack/react-simple-icons';
import type { TaskTemplate, TaskTemplateIcon, TaskTemplateSkillRequirement } from '@lobechat/const';
import { type LucideIcon, Sparkles } from 'lucide-react';

import { getProviderMeta } from './providerMeta';

export type TemplateIconComponent = IconType | LucideIcon;

export type TemplateIconSpec =
  | { Comp: TemplateIconComponent; kind: 'component' }
  | { kind: 'url'; src: string };

const SELF_ICON_MAP: Record<TaskTemplateIcon, TemplateIconComponent> = {
  github: SiGithub,
};

const toSpec = (icon: string | TemplateIconComponent): TemplateIconSpec =>
  typeof icon === 'string' ? { kind: 'url', src: icon } : { Comp: icon, kind: 'component' };

/**
 * Resolve the icon to display on a task-template card.
 *
 * Priority: self icon (`template.icon`) > first resolvable skill provider
 * (required before optional) > interest icon > `Sparkles`. Unknown providers
 * are skipped so a stale template never crashes the card.
 */
export const resolveTemplateIcon = (
  template: TaskTemplate,
  interestIconMap: ReadonlyMap<string, LucideIcon>,
): TemplateIconSpec => {
  if (template.icon) {
    return { Comp: SELF_ICON_MAP[template.icon], kind: 'component' };
  }

  for (const spec of [template.requiresSkills?.[0], template.optionalSkills?.[0]]) {
    if (!spec) continue;
    const meta = getProviderMeta(spec);
    if (meta) return toSpec(meta.icon);
  }

  const interestKey = template.interests[0];
  const interestIcon = interestKey ? interestIconMap.get(interestKey) : undefined;
  return { Comp: interestIcon ?? Sparkles, kind: 'component' };
};

/**
 * The skill spec whose visual the card's main icon already represents.
 *
 * Mirrors the self/skill branches of `resolveTemplateIcon` so callers can hide
 * that provider from inline lists (e.g. the auth row) to avoid showing the
 * same logo twice on a card. Returns `undefined` when the main icon falls back
 * to the interest icon or `Sparkles` — those carry no provider semantics.
 */
export const getMainIconProvider = (
  template: TaskTemplate,
): TaskTemplateSkillRequirement | undefined => {
  // The self-icon union is currently the single lobehub provider id 'github';
  // expand `SELF_ICON_MAP` and this mapping together when more are added.
  if (template.icon) return { provider: template.icon, source: 'lobehub' };

  for (const spec of [template.requiresSkills?.[0], template.optionalSkills?.[0]]) {
    if (!spec) continue;
    if (getProviderMeta(spec)) return spec;
  }
  return undefined;
};
