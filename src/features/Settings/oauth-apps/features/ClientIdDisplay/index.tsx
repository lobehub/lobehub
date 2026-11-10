'use client';

import { ActionIcon, Flexbox, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Copy } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  id: {
    overflow: 'hidden',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '13px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

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
      <span {...stylex.props(styles.id)}>{clientId}</span>
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
