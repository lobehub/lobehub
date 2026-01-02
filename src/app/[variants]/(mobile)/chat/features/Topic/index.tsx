import { Flexbox } from '@lobehub/ui';

import TopicSearchBar from '@/app/[variants]/(main)/chat/_layout/Sidebar/Topic/TopicSearchBar';

import TopicModal from './features/TopicModal';

const Topic = () => {
  return (
    <TopicModal>
      <Flexbox gap={8} height={'100%'} padding={'8px 8px 0'} style={{ overflow: 'hidden' }}>
        <TopicSearchBar />
        <Flexbox
          height={'100%'}
          style={{ marginInline: -8, overflow: 'hidden', position: 'relative' }}
          width={'calc(100% + 16px)'}
        >
          <Topic />
        </Flexbox>
      </Flexbox>
    </TopicModal>
  );
};

export default Topic;
