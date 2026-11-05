// Fixture: the event kind maps to a translated label; the model id stays raw.
import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface ActivityRowProps {
  event: { kind: 'attach_work' | 'cancelled' | 'created'; model: string; title: string };
}

const ActivityRow = memo<ActivityRowProps>(({ event }) => {
  const { t } = useTranslation('goal');

  return (
    <Flexbox horizontal gap={8}>
      <Text type={'secondary'}>{t(`activity.kind.${event.kind}`)}</Text>
      <Text>{event.title}</Text>
      <Text type={'secondary'}>{event.model}</Text>
    </Flexbox>
  );
});

export default ActivityRow;
