import { Text } from '@lobehub/ui';
import { memo } from 'react';

import { useVerifyReportBundle } from '@/features/Acceptance/hooks';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Title = memo(() => {
  const runId = useChatStore(chatPortalSelectors.verifyReportRunId);
  const { data } = useVerifyReportBundle(runId ?? null);

  return (
    <Text ellipsis={{ tooltipWhenOverflow: true }} style={{ minWidth: 0 }}>
      {data?.run.title || 'Verify report'}
    </Text>
  );
});

export default Title;
