import { Flexbox, Highlighter, Tag } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import * as motion from 'motion/react-m';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type MCPErrorInfoMetadata } from '@/types/plugins';

const ErrorDetails = memo<{
  errorInfo: MCPErrorInfoMetadata;
  errorMessage?: string;
}>(({ errorInfo, errorMessage }) => {
  const { t } = useTranslation('plugin');

  return (
    <Flexbox gap={8}>
      <motion.div
        animate={{ height: 'auto', opacity: 1 }}
        initial={{ height: 0, opacity: 0 }}
        style={{ overflow: 'hidden' }}
      >
        <Flexbox
          gap={8}
          style={{
            backgroundColor: cssVar.colorFillQuaternary,
            borderRadius: 8,
            fontFamily: 'monospace',
            fontSize: '11px',
            padding: '8px 12px',
          }}
        >
          {errorInfo.params && (
            <Flexbox gap={4}>
              <div>
                <Tag color="blue" variant={'filled'}>
                  {t('mcpInstall.errorDetails.connectionParams')}
                </Tag>
              </div>
              <div style={{ marginTop: 4, wordBreak: 'break-all' }}>
                {errorInfo.params.command && (
                  <div>
                    {t('mcpInstall.errorDetails.command')}: {errorInfo.params.command}
                  </div>
                )}
                {errorInfo.params.args && (
                  <div>
                    {t('mcpInstall.errorDetails.args')}: {errorInfo.params.args.join(' ')}
                  </div>
                )}
              </div>
            </Flexbox>
          )}

          {errorInfo.errorLog && (
            <Flexbox gap={4}>
              <div>
                <Tag color="red" variant={'filled'}>
                  {t('mcpInstall.errorDetails.errorOutput')}
                </Tag>
              </div>
              <Highlighter
                language={'log'}
                style={{
                  maxHeight: 200,
                  overflow: 'auto',
                }}
              >
                {errorInfo.errorLog}
              </Highlighter>
            </Flexbox>
          )}

          {errorInfo.originalError && errorInfo.originalError !== errorMessage && (
            <div>
              <Tag color="orange">{t('mcpInstall.errorDetails.originalError')}</Tag>
              <div style={{ marginTop: 4, wordBreak: 'break-all' }}>{errorInfo.originalError}</div>
            </div>
          )}
        </Flexbox>
      </motion.div>
    </Flexbox>
  );
});

export default ErrorDetails;
