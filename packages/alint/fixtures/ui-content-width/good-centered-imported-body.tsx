// Fixture: the route centers imported feature bodies; each body caps its own width.
// Reduced from routes/(main)/agent/channel (PlatformGrid / PlatformDetail cap at 1024px).
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useParams } from 'react-router';

import PlatformDetail from '@/features/AgentChannel/PlatformDetail';
import PlatformGrid from '@/features/AgentChannel/PlatformGrid';

import Header from './Header';

const container = {
  alignItems: 'center',
  display: 'flex',
  flex: 1,
  flexDirection: 'column',
  overflowY: 'auto',
  width: '100%',
} as const;

const ChannelPage = memo(() => {
  const { aid, platform } = useParams<{ aid: string; platform?: string }>();

  return (
    <Flexbox flex={1} height={'100%'}>
      <Header agentId={aid!} platformId={platform} />
      <div style={container}>
        {platform ? (
          <PlatformDetail agentId={aid!} platformId={platform} />
        ) : (
          <PlatformGrid agentId={aid!} />
        )}
      </div>
    </Flexbox>
  );
});

export default ChannelPage;
