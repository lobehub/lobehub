import { EmptyState } from '@lobehub/ui';
import { Flexbox } from 'react-layout-kit';

interface StatusPageProps {
  status: 'unpublished' | 'archived' | 'deprecated';
}

const StatusPage = ({ status }: StatusPageProps) => {
  const messages = {
    archived: {
      description: 'This group agent has been archived and is no longer available.',
      title: 'Group Agent Archived',
    },
    deprecated: {
      description: 'This group agent has been deprecated and is no longer maintained.',
      title: 'Group Agent Deprecated',
    },
    unpublished: {
      description: 'This group agent is not yet published or has been unpublished.',
      title: 'Group Agent Unpublished',
    },
  };

  const message = messages[status] || messages.unpublished;

  return (
    <Flexbox align="center" justify="center" style={{ minHeight: '60vh', padding: 24 }}>
      <EmptyState description={message.description} title={message.title} />
    </Flexbox>
  );
};

export default StatusPage;
