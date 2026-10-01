// Fixture: a connection card whose secondary actions are all primary.
import { Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface ChannelCardProps {
  name: string;
  onCheckUpdate: () => void;
  onReconnect: () => void;
}

const ChannelCard = memo<ChannelCardProps>(({ name, onCheckUpdate, onReconnect }) => {
  const { t } = useTranslation('setting');

  return (
    <Flexbox horizontal align={'center'} justify={'space-between'}>
      <Text>{name}</Text>
      <Flexbox horizontal gap={8}>
        <Button size={'small'} type={'primary'} onClick={onCheckUpdate}>
          {t('device.checkUpdate')}
        </Button>
        {/* alint-expect */}
        <Button type={'primary'} onClick={onReconnect}>
          {t('device.reconnect')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

export default ChannelCard;
