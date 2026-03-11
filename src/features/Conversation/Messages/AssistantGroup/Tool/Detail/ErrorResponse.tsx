import { type ChatMessageError, type ChatPluginPayload } from '@lobechat/types';
import { Alert, Flexbox, Highlighter } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import PluginSettings from './PluginSettings';

const styles = createStaticStyles(({ css }) => ({
  errorResponseExtra: css`
    padding-inline-start: 12px;
  `,
}));

interface ErrorResponseProps extends ChatMessageError {
  id: string;
  plugin?: ChatPluginPayload;
}

const ErrorResponse = memo<ErrorResponseProps>(({ id, type, body, message, plugin }) => {
  const { t } = useTranslation('error');
  if (type === 'PluginSettingsInvalid') {
    return <PluginSettings id={id} plugin={plugin} />;
  }

  return (
    <Alert
      showIcon
      title={t(`response.${type}` as any)}
      type={'secondary'}
      extra={
        <Flexbox className={styles.errorResponseExtra}>
          <Highlighter actionIconSize={'small'} language={'json'} variant={'borderless'}>
            {JSON.stringify(body || { message, type }, null, 2)}
          </Highlighter>
        </Flexbox>
      }
    />
  );
});
export default ErrorResponse;
