'use client';

import { ActionIcon } from '@lobehub/ui';
import { App, Flex } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Copy } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  id: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface ClientIdDisplayProps {
  clientId: string;
}

const ClientIdDisplay: FC<ClientIdDisplayProps> = ({ clientId }) => {
  const { t } = useTranslation('auth');
  const { message } = App.useApp();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(clientId);
      message.success(t('oauthApp.copy.success'));
    } catch {
      message.error(t('oauthApp.copy.error'));
    }
  };

  return (
    <Flex align="center" gap={4}>
      <span className={styles.id}>{clientId}</span>
      <ActionIcon
        icon={Copy}
        size="small"
        title={t('oauthApp.copy.tooltip')}
        onClick={handleCopy}
      />
    </Flex>
  );
};

export default ClientIdDisplay;
