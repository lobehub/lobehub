import { Flexbox, Text } from '@lobehub/ui';

import { useVerifyState } from '@/features/Verify/hooks';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { oneLineEllipsis } from '@/styles';

const Title = () => {
  const operationId = useChatStore(chatPortalSelectors.verifyResultOperationId);
  const checkItemId = useChatStore(chatPortalSelectors.verifyResultCheckItemId);
  const { data: state } = useVerifyState(operationId ?? null);

  const item = (state?.verifyPlan ?? []).find((i) => i.id === checkItemId);

  return (
    <Flexbox horizontal align={'center'} gap={4}>
      <Text className={oneLineEllipsis} style={{ fontSize: 16 }} type={'secondary'}>
        {item?.title}
      </Text>
    </Flexbox>
  );
};

export default Title;
