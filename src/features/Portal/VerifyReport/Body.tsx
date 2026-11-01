import { memo } from 'react';

import { ReportViewer } from '@/features/Acceptance';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Body = memo(() => {
  const runId = useChatStore(chatPortalSelectors.verifyReportRunId);

  return <ReportViewer runId={runId} />;
});

export default Body;
