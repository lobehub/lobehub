import { useTranslation } from 'react-i18next';

import { useConnectorManageable } from '@/hooks/useConnectorManagePolicy';
import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

/**
 * Whether the viewer may open a marketplace connector's edit drawer. The drawer
 * reads the stored credentials (`connector.getForEdit`), which only the
 * creator or a workspace owner may, so this follows the credentials gate the
 * way ConnectorDetail's Edit does. `deniedTitle` explains a refusal; while the
 * policy loads the action is refused without a reason yet.
 */
export const useConnectorConfigureGate = (connector: ConnectorWithTools, canEdit: boolean) => {
  const { t: tTool } = useTranslation('tool');
  const { t: ts } = useTranslation('setting');
  const { canManageCredentials, isPending, restrictedByPolicy } = useConnectorManageable(connector);

  const deniedTitle =
    canManageCredentials || isPending
      ? undefined
      : restrictedByPolicy
        ? ts('tools.connectorFeedback.manageOnly')
        : tTool(
            'connector.manageOnlyCreator',
            'Only the creator or a workspace owner can manage this connector',
          );

  return { allowed: canEdit && canManageCredentials, deniedTitle };
};
