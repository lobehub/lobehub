import { Button, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Link2 } from 'lucide-react';
import Link from 'next/link';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

import { type MemorySource } from '@/database/repositories/userMemory';

const SourceLink = memo<{ source?: MemorySource | null }>(({ source }) => {
  const navigate = useNavigate();

  if (!source) return;

  const title = source.title || source.id?.replace('tpc_', '').slice(0, 8);

  return (
    <Link
      href={`/agent/${source.agentId}?topicId=${source.id}`}
      onClick={(e) => {
        if (!source) return;
        e.stopPropagation();
        e.preventDefault();
        navigate(`/agent/${source.agentId}?topicId=${source.id}`);
      }}
      style={{
        flex: 1,
        maxWidth: '100%',
        overflow: 'hidden',
      }}
    >
      <Button
        icon={<Icon icon={Link2} />}
        size={'small'}
        style={{
          flex: 1,
          maxWidth: '100%',
          overflow: 'hidden',
        }}
        title={title}
        type={'text'}
      >
        <Text color={cssVar.colorTextSecondary} ellipsis>
          {title}
        </Text>
      </Button>
    </Link>
  );
});

export default SourceLink;
