import { Button, Flexbox, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { ErrorLine } from '@/features/Dashboard/ErrorLine';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { useToolStore } from '@/store/tool';

import { getOAuthErrorPresentation } from './oauthErrorPresentation';

interface MCPOAuthAuthorizationProps {
  error?: string;
  identifier: string;
}

export const MCPOAuthAuthorization = ({ error, identifier }: MCPOAuthAuthorizationProps) => {
  const { t } = useTranslation('plugin');
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const authorizeMCPPlugin = useToolStore((s) => s.authorizeMCPPlugin);
  const togglePlugin = useAgentStore((s) => s.togglePlugin);
  const oauthErrors = {
    blocked: t('dev.oauthError.blocked'),
    dismissed: t('dev.oauthError.dismissed'),
    failed: t('dev.oauthError.failed'),
    timeout: t('dev.oauthError.timeout'),
  };
  const errorPresentation = error ? getOAuthErrorPresentation(error, oauthErrors) : undefined;

  return (
    <Flexbox gap={8} paddingBlock={8}>
      <Text>{t('mcpInstall.AUTHORIZATION_REQUIRED')}</Text>
      {errorPresentation && <ErrorLine key={error} {...errorPresentation} />}
      <Button
        disabled={!canCreate || !canEdit}
        type={'primary'}
        onClick={async () => {
          if (!canCreate || !canEdit) return;
          if (await authorizeMCPPlugin(identifier)) await togglePlugin(identifier, true);
        }}
      >
        {t('dev.mcp.auth.oauth.authorize')}
      </Button>
    </Flexbox>
  );
};
