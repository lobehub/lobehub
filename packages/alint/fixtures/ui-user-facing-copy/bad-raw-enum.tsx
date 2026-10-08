// Fixture: an activity row printing the raw event kind and a hard-coded label.
import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';

interface ActivityRowProps {
  event: { kind: 'attach_work' | 'cancelled' | 'created'; title: string };
}

const ActivityRow = memo<ActivityRowProps>(({ event }) => (
  <Flexbox horizontal gap={8}>
    {/* alint-expect */}
    <Text type={'secondary'}>{event.kind}</Text>
    <Text>{event.title}</Text>
    <Text type={'secondary'}>Auto</Text>
  </Flexbox>
));

export default ActivityRow;
