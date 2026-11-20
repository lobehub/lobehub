// Fixture: a report linking back to its conversation through the legacy path.
import { Icon } from '@lobehub/ui';
import { MessagesSquare } from 'lucide-react';
import { memo } from 'react';

const OriginLink = memo<{ topicId: string }>(({ topicId }) => (
  // alint-expect
  <a href={`/chat?topic=${topicId}`} rel="noreferrer" target="_blank">
    <Icon icon={MessagesSquare} />
  </a>
));

export default OriginLink;
