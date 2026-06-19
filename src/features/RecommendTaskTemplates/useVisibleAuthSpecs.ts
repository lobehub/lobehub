import type { TaskTemplate, TaskTemplateConnector } from '@lobechat/const';
import { useMemo } from 'react';

import { getMainIconProvider } from './resolveTemplateIcon';
import { useIsConnectorConnected } from './useConnectorConnection';

interface UseVisibleAuthSpecsOptions {
  /**
   * Drop the provider already shown as the main card icon to avoid showing the
   * same logo twice on the recommend card. Modal callers should keep this off:
   * surfacing every unconnected connector prevents surprises when "Add task"
   * triggers OAuth.
   */
  hideMainIconProvider?: boolean;
}

export const useVisibleAuthSpecs = (
  template: TaskTemplate,
  { hideMainIconProvider = false }: UseVisibleAuthSpecsOptions = {},
): TaskTemplateConnector[] => {
  const isConnectorConnected = useIsConnectorConnected();
  const mainIconProvider = useMemo(
    () => (hideMainIconProvider ? getMainIconProvider(template) : undefined),
    [hideMainIconProvider, template],
  );

  return useMemo(() => {
    return template.connectors.filter((spec) => {
      if (isConnectorConnected(spec)) return false;
      if (
        mainIconProvider &&
        mainIconProvider.identifier === spec.identifier &&
        mainIconProvider.source === spec.source
      ) {
        return false;
      }
      return true;
    });
  }, [template.connectors, isConnectorConnected, mainIconProvider]);
};
