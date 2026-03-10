import { Alert, Button, Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { type MCPErrorInfo } from '@/types/plugins';

import ErrorDetails from './ErrorDetails';

interface InstallErrorProps {
  errorInfo: MCPErrorInfo;
  identifier: string;
}

const InstallError = memo<InstallErrorProps>(({ errorInfo, identifier }) => {
  const { t } = useTranslation(['plugin', 'common']);

  const cancelInstallMCPPlugin = useToolStore((s) => s.cancelInstallMCPPlugin);

  return (
    <Flexbox gap={8}>
      <Alert
        type="error"
        variant={'borderless'}
        action={
          <Flexbox>
            <Button
              color={'default'}
              size={'small'}
              variant={'filled'}
              onClick={() => {
                cancelInstallMCPPlugin(identifier);
              }}
            >
              {t('common:close')}
            </Button>
          </Flexbox>
        }
        title={t('mcpInstall.installError', {
          detail: t(`mcpInstall.errorTypes.${errorInfo.type}`),
        })}
      />
      {errorInfo.metadata && (
        <ErrorDetails errorInfo={errorInfo.metadata} errorMessage={errorInfo.message} />
      )}
    </Flexbox>
  );
});
export default InstallError;
