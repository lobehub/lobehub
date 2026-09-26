import { Flexbox } from '@lobehub/ui';
import { Skeleton, Text } from '@lobehub/ui/base-ui';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useFileStore } from '@/store/file';
import { oneLineEllipsis } from '@/styles';

const Title = () => {
  const previewFileId = useChatStore(chatPortalSelectors.previewFileId);

  const useFetchFileItem = useFileStore((s) => s.useFetchKnowledgeItem);

  const { data, isLoading } = useFetchFileItem(previewFileId);

  return (
    <Flexbox horizontal align={'center'} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
      {/* Back and close live in the shared portal header — no second arrow here. */}
      {isLoading ? (
        <Skeleton height={28} />
      ) : (
        <Text className={oneLineEllipsis} style={{ fontSize: 16 }} type={'secondary'}>
          {data?.name}
        </Text>
      )}
    </Flexbox>
  );
};

export default Title;
