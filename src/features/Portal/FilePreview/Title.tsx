import { ActionIcon, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { ArrowLeft } from 'lucide-react';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useFileStore } from '@/store/file';
import { oneLineEllipsis } from '@/styles';

const Title = () => {
  const [closeFilePreview, previewFileId] = useChatStore((s) => [
    s.closeFilePreview,
    chatPortalSelectors.previewFileId(s),
  ]);

  const useFetchFileItem = useFileStore((s) => s.useFetchKnowledgeItem);

  const { data, isLoading } = useFetchFileItem(previewFileId);

  return (
    <Flexbox align={'center'} gap={4} horizontal>
      <ActionIcon icon={ArrowLeft} onClick={() => closeFilePreview()} size={'small'} />

      {isLoading ? (
        <Skeleton.Button active style={{ height: 28 }} />
      ) : (
        <Text className={oneLineEllipsis} style={{ fontSize: 16 }} type={'secondary'}>
          {data?.name}
        </Text>
      )}
    </Flexbox>
  );
};

export default Title;
