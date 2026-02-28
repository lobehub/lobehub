import { Button, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Link2 } from 'lucide-react';
import { memo } from 'react';

import { type MemorySource } from '@/database/repositories/userMemory';
import Link from '@/libs/router/Link';

const SourceLink = memo<{ source?: MemorySource | null }>(({ source }) => {
  if (!source) return;

  const title = source.title || source.id?.replace('tpc_', '').slice(0, 8);

  return (
    <Link
      href={`/agent/${source.agentId}?topic=${source.id}`}
      style={{
        flex: 1,
        maxWidth: '100%',
        overflow: 'hidden',
      }}
    >
      <Button
        icon={<Icon icon={Link2} />}
        size={'small'}
        title={title}
        type={'text'}
        style={{
          flex: 1,
          maxWidth: '100%',
          overflow: 'hidden',
        }}
      >
        <Text ellipsis color={cssVar.colorTextSecondary}>
          {title}
        </Text>
      </Button>
    </Link>
  );
});

export default SourceLink;
