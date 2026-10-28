// Fixture: a centered failure state whose only way forward is a small "regenerate" button.
// Shaped after AgentChannel quickSetup/FeishuQuickCreate's expired-QR state.
import { Center, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const QrExpiredState = memo<{ onRegenerate: () => void }>(({ onRegenerate }) => {
  const { t } = useTranslation('agent');

  return (
    <Center gap={12} padding={24}>
      <Icon icon={TriangleAlertIcon} size={32} />
      <Text type={'danger'}>{t('channel.quickSetup.feishu.scan.expired')}</Text>
      {/* alint-expect */}
      <Button icon={<Icon icon={RefreshCwIcon} />} size={'small'} onClick={onRegenerate}>
        {t('channel.quickSetup.feishu.scan.regenerate')}
      </Button>
    </Center>
  );
});

export default QrExpiredState;
