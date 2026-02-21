import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ListTree } from 'lucide-react';
import { memo } from 'react';

import BubblesLoading from '@/components/BubblesLoading';
import { LOADING_FLAT } from '@/const/message';
import { useChatStore } from '@/store/chat';
import { portalThreadSelectors } from '@/store/chat/selectors';
import { oneLineEllipsis } from '@/styles';

const Active = memo(() => {
  const currentThread = useChatStore(portalThreadSelectors.portalCurrentThread, isEqual);

  return (
    currentThread && (
      <Flexbox horizontal align={'center'} gap={8} style={{ marginInlineStart: 4 }}>
        <Icon color={cssVar.colorTextSecondary} icon={ListTree} size={18} />
        <Text
          className={oneLineEllipsis}
          ellipsis={true}
          style={{ color: cssVar.colorTextSecondary, fontSize: 14 }}
        >
          {currentThread?.title === LOADING_FLAT ? (
            <Flexbox flex={1} height={30} justify={'center'}>
              <BubblesLoading />
            </Flexbox>
          ) : (
            currentThread?.title
          )}
        </Text>
      </Flexbox>
    )
  );
});

export default Active;
