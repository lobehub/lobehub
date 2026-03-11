import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Switch } from 'antd';
import { GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { portalThreadSelectors } from '@/store/chat/selectors';
import { oneLineEllipsis } from '@/styles';
import { ThreadType } from '@/types/topic';

const NewThreadHeader = () => {
  const { t } = useTranslation('thread');

  const [newThreadMode] = useChatStore((s) => [portalThreadSelectors.newThreadMode(s)]);

  return (
    <Flexbox horizontal align={'center'} gap={8} style={{ marginInlineStart: 4 }}>
      <Icon icon={GitBranch} size={18} />
      <Text ellipsis className={oneLineEllipsis} style={{ fontSize: 14 }}>
        {t('newPortalThread.title')}
      </Text>
      <Flexbox horizontal align={'center'} gap={8}>
        <Switch
          checked={newThreadMode === ThreadType.Continuation}
          size={'small'}
          style={{ marginInlineStart: 12 }}
          onChange={(e) => {
            useChatStore.setState({
              newThreadMode: e ? ThreadType.Continuation : ThreadType.Standalone,
            });
          }}
        />
        {t('newPortalThread.includeContext')}
      </Flexbox>
    </Flexbox>
  );
};

export default NewThreadHeader;
