// Fixture: a card with one primary action and a fill secondary — taste, not this rule.
import { Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface ConnectCardProps {
  name: string;
  onConnect: () => void;
  onLearnMore: () => void;
}

const ConnectCard = memo<ConnectCardProps>(({ name, onConnect, onLearnMore }) => {
  const { t } = useTranslation('setting');

  return (
    <Flexbox gap={12}>
      <Text>{name}</Text>
      <Flexbox horizontal gap={8}>
        <Button type={'fill'} onClick={onLearnMore}>
          {t('integration.learnMore')}
        </Button>
        <Button type={'primary'} onClick={onConnect}>
          {t('integration.connect')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

export default ConnectCard;
