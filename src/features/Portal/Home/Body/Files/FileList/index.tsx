import { Avatar, Center, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { InboxIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonLoading from '@/components/Loading/SkeletonLoading';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';

import FileItem from './Item';

/**
 * Native balancing instead of react-wrap-balancer: this empty state is pre-rendered
 * inside the hidden portal, and the library's layout-effect binary search forced
 * ~20 synchronous page layouts in the commit that opens an artifact.
 */
const BALANCED_TEXT: CSSProperties = { textWrap: 'balance' };

const FileList = () => {
  const { t } = useTranslation('portal');
  const files = useChatStore(chatSelectors.currentUserFiles, isEqual);
  const isCurrentChatLoaded = useChatStore(chatSelectors.isCurrentChatLoaded);

  return !isCurrentChatLoaded ? (
    <Flexbox gap={12} paddingInline={12}>
      <SkeletonLoading />
    </Flexbox>
  ) : files.length === 0 ? (
    <Center
      gap={8}
      paddingBlock={24}
      style={{ border: `1px dashed ${cssVar.colorSplit}`, borderRadius: 8, marginInline: 12 }}
    >
      <Avatar
        avatar={<Icon icon={InboxIcon} size={'large'} />}
        background={cssVar.colorFillTertiary}
        shape={'square'}
        size={48}
      />
      <Text style={BALANCED_TEXT} type={'secondary'}>
        {t('emptyKnowledgeList')}
      </Text>
    </Center>
  ) : (
    <Flexbox gap={12} paddingInline={12}>
      {files.map((m) => (
        <FileItem {...m} key={m.id} />
      ))}
    </Flexbox>
  );
};

export default FileList;
