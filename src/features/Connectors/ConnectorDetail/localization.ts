import { type TFunction } from 'i18next';

import { type ConnectorToolPermission } from '@/database/schemas';

interface LocalizableConnector {
  identifier: string;
  metadata?: Record<string, unknown> | null;
  name: string;
  sourceType: string;
}

interface LocalizableProvider {
  description?: string;
  label: string;
}

interface LocalizableConnectorTool {
  description?: string | null;
  displayName?: string | null;
  toolName: string;
}

interface GetLocalizedConnectorDetailOptions {
  composioApp?: LocalizableProvider;
  connector: LocalizableConnector;
  lobehubProvider?: LocalizableProvider;
  t: TFunction<'setting'>;
}

type ConnectorPermissionStatus = ConnectorToolPermission | 'custom';

export const getConnectorPermissionStatus = (
  tools: Array<{ permission: ConnectorToolPermission }>,
): ConnectorPermissionStatus => {
  const firstPermission = tools[0]?.permission;

  if (!firstPermission) return 'custom';

  return tools.every((tool) => tool.permission === firstPermission) ? firstPermission : 'custom';
};

export const getLocalizedConnectorDetail = ({
  composioApp,
  connector,
  lobehubProvider,
  t,
}: GetLocalizedConnectorDetailOptions) => {
  const rawDescription =
    typeof connector.metadata?.description === 'string'
      ? connector.metadata.description
      : undefined;

  if (connector.sourceType === 'builtin') {
    return {
      description: t(`tools.builtins.${connector.identifier}.description`, {
        defaultValue: rawDescription || '',
      }),
      name: t(`tools.builtins.${connector.identifier}.title`, {
        defaultValue: connector.name,
      }),
    };
  }

  if (lobehubProvider) {
    return {
      description: t(`tools.lobehubSkill.providers.${connector.identifier}.description`, {
        defaultValue: lobehubProvider.description || rawDescription || '',
      }),
      name: lobehubProvider.label,
    };
  }

  if (composioApp) {
    return {
      description: t(`tools.composio.servers.${connector.identifier}.description`, {
        defaultValue: composioApp.description || rawDescription || '',
      }),
      name: composioApp.label,
    };
  }

  return {
    description: rawDescription,
    name: connector.name,
  };
};

export const getLocalizedConnectorTool = (
  connectorIdentifier: string,
  tool: LocalizableConnectorTool,
  t: TFunction<'plugin'>,
) => ({
  description: tool.description
    ? t(`builtins.${connectorIdentifier}.apiDescription.${tool.toolName}`, {
        defaultValue: tool.description,
      })
    : undefined,
  name: t(`builtins.${connectorIdentifier}.apiName.${tool.toolName}`, {
    defaultValue: tool.displayName || tool.toolName,
  }),
  toolName: tool.toolName,
});
