import { Avatar, Center, Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { Origami } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Balancer from 'react-wrap-balancer';

import { useChatStore } from '@/store/chat';
import { dbMessageSelectors, displayMessageSelectors } from '@/store/chat/selectors';

import ArtifactItem from './Item';

const ArtifactList = () => {
  const { t } = useTranslation('portal');
  const messages = useChatStore(dbMessageSelectors.dbToolMessages, isEqual);
  const isCurrentChatLoaded = useChatStore(displayMessageSelectors.isCurrentDisplayChatLoaded);

  return !isCurrentChatLoaded ? (
    <Flexbox gap={12} paddingInline={12}>
      {[1, 1, 1, 1, 1, 1].map((key, index) => (
        <Skeleton.Button
          active
          block
          key={`${key}-${index}`}
          style={{ borderRadius: 8, height: 68 }}
        />
      ))}
    </Flexbox>
  ) : messages.length === 0 ? (
    <Center
      gap={8}
      paddingBlock={24}
      style={{ border: `1px dashed ${cssVar.colorSplit}`, borderRadius: 8, marginInline: 12 }}
    >
      <Avatar
        avatar={<Icon icon={Origami} size={'large'} />}
        background={cssVar.colorFillTertiary}
        shape={'square'}
        size={48}
      />
      <Balancer>
        <Text type={'secondary'}>{t('emptyArtifactList')}</Text>
      </Balancer>
    </Center>
  ) : (
    <Flexbox gap={12} paddingInline={12}>
      {messages.map((m) => (
        <ArtifactItem
          identifier={m.plugin?.identifier}
          key={m.id}
          messageId={m.id}
          payload={m.plugin}
        />
      ))}
    </Flexbox>
  );
};

export default ArtifactList;
