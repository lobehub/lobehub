import { memo } from 'react';

import { useVerifyReportBundle } from '@/features/Verify/hooks';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Title = memo(() => {
  const runId = useChatStore(chatPortalSelectors.verifyReportRunId);
  const { data } = useVerifyReportBundle(runId ?? null);

  return data?.run.title || 'Verify report';
});

export default Title;
