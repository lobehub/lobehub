import type { TaskTemplate, TaskTemplateSkillRequirement } from '@lobechat/const';
import { useMemo } from 'react';

import { getMainIconProvider } from './resolveTemplateIcon';
import { useIsSkillConnected } from './useSkillConnection';

interface UseVisibleAuthSpecsOptions {
  /**
   * Drop the provider already shown as the main card icon to avoid showing the
   * same logo twice on the recommend card. Modal callers should keep this off:
   * surfacing every unconnected skill prevents surprises when "Add task"
   * triggers OAuth.
   */
  hideMainIconProvider?: boolean;
}

export const useVisibleAuthSpecs = (
  template: TaskTemplate,
  { hideMainIconProvider = false }: UseVisibleAuthSpecsOptions = {},
): TaskTemplateSkillRequirement[] => {
  const isSkillConnected = useIsSkillConnected();
  const mainIconProvider = useMemo(
    () => (hideMainIconProvider ? getMainIconProvider(template) : undefined),
    [hideMainIconProvider, template],
  );

  return useMemo(() => {
    const all = [...(template.requiresSkills ?? []), ...(template.optionalSkills ?? [])];
    return all.filter((spec) => {
      if (isSkillConnected(spec)) return false;
      if (
        mainIconProvider &&
        mainIconProvider.provider === spec.provider &&
        mainIconProvider.source === spec.source
      ) {
        return false;
      }
      return true;
    });
  }, [template.requiresSkills, template.optionalSkills, isSkillConnected, mainIconProvider]);
};
