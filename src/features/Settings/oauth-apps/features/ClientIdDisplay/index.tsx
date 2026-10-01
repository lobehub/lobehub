'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, toast } from '@lobehub/ui/base-ui';
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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(clientId);
      toast.success(t('oauthApp.copy.success'));
    } catch {
      toast.error(t('oauthApp.copy.error'));
    }
  };

  return (
    <Flexbox horizontal align={'center'} gap={4}>
      <span className={styles.id}>{clientId}</span>
      <ActionIcon
        icon={Copy}
        size="small"
        title={t('oauthApp.copy.tooltip')}
        onClick={handleCopy}
      />
    </Flexbox>
  );
};

export default ClientIdDisplay;
